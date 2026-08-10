// meerkat-client is the thin native client for meerkat-daemon. It owns nothing but the
// terminal: reading a line, sending it down a Unix socket, and printing
// whatever comes back. All parsing, execution, and job state live in the
// daemon so this binary starts near-instantly and stays that way even as
// the daemon grows heavier (Oban, erlexec, a TUI job panel, ...).
package main

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/chzyer/readline"
)

// builtins mirrors MeerkatDaemon.Evaluator's @builtins — kept here only so
// Tab completion knows about them, not to duplicate any execution logic.
var builtins = []string{"cd", "exit", "quit", "jobs", "fg", "bg", "kill", "stop"}

// Wire protocol: 4-byte big-endian length prefix, then a payload whose
// first byte is a type tag — matches meerkat-daemon's `packet: 4` socket
// (see meerkat_daemon/connection.ex). meerkat-daemon added real pty
// support for foreground commands, which needs raw unbuffered output (see
// the "P" case below) — meerkat-client speaks the same framing to stay
// compatible, but doesn't put the local terminal into raw mode or forward
// keystrokes to a running job's pty, so full-screen programs (vim, htop)
// aren't usable from here. That interactive experience lives in
// meerkat-app only; this client keeps its existing line-oriented REPL feel.
const (
	msgLine   = 'L'
	msgStdout = 'O'
	msgStderr = 'E'
	msgCwd    = 'D'
	msgPty    = 'P'
	msgExit   = 'X'
)

func writeFrame(w io.Writer, msgType byte, payload []byte) error {
	frame := make([]byte, 4+1+len(payload))
	binary.BigEndian.PutUint32(frame[:4], uint32(1+len(payload)))
	frame[4] = msgType
	copy(frame[5:], payload)
	_, err := w.Write(frame)
	return err
}

// readFrame blocks for the next frame. ok=false once the connection closes.
func readFrame(r *bufio.Reader) (msgType byte, payload []byte, ok bool) {
	var lenBuf [4]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		return 0, nil, false
	}
	n := binary.BigEndian.Uint32(lenBuf[:])
	if n == 0 {
		return 0, nil, false
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return 0, nil, false
	}
	return buf[0], buf[1:], true
}

func socketPath() string {
	if p := os.Getenv("MEERKAT_SOCK"); p != "" {
		return p
	}
	u, err := user.Current()
	if err != nil {
		return "/tmp/meerkat.sock"
	}
	return filepath.Join(u.HomeDir, ".meerkat", "meerkat.sock")
}

func historyPath() string {
	u, err := user.Current()
	if err != nil {
		return ""
	}
	return filepath.Join(u.HomeDir, ".meerkat", "history")
}

// startCmd is how the daemon gets launched if it isn't already running.
// Override via MEERKAT_START_CMD once you're running a built release
// instead of `mix run` in dev — e.g. "/opt/meerkat/bin/meerkat-daemon start".
func startCmd() (string, string) {
	cmd := os.Getenv("MEERKAT_START_CMD")
	if cmd == "" {
		cmd = "mix run --no-halt"
	}
	dir := os.Getenv("MEERKAT_DIR")
	if dir == "" {
		dir = "."
	}
	return cmd, dir
}

func dial(path string) (net.Conn, error) {
	return net.DialTimeout("unix", path, 500*time.Millisecond)
}

func ensureDaemon(path string) (net.Conn, error) {
	if conn, err := dial(path); err == nil {
		return conn, nil
	}

	cmdStr, dir := startCmd()
	cmd := exec.Command("sh", "-c", cmdStr)
	cmd.Dir = dir
	// Detach fully: new session, no controlling terminal, so the daemon
	// outlives this client and isn't killed by Ctrl+C in the shell tab.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	logPath := filepath.Join(filepath.Dir(path), "daemon.log")
	if logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); err == nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}

	fmt.Fprintln(os.Stderr, "meerkat-client: no daemon at", path, "- starting one ("+cmdStr+")")
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start daemon: %w", err)
	}

	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if conn, err := dial(path); err == nil {
			return conn, nil
		}
		time.Sleep(150 * time.Millisecond)
	}
	return nil, fmt.Errorf("daemon did not come up within 8s (check %s)", logPath)
}

func main() {
	path := socketPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "meerkat-client: cannot create", filepath.Dir(path), err)
		os.Exit(1)
	}

	conn, err := ensureDaemon(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "meerkat-client:", err)
		os.Exit(1)
	}
	defer conn.Close()

	server := bufio.NewReader(conn)
	cwd := "~"

	// Initial "D" banner sent by the daemon on connect.
	if msgType, payload, ok := readFrame(server); ok && msgType == msgCwd {
		cwd = string(payload)
	}

	completer := &pathCompleter{cwd: &cwd}
	rl, err := readline.NewEx(&readline.Config{
		Prompt:          promptFor(cwd),
		HistoryFile:     historyPath(),
		AutoComplete:    completer,
		InterruptPrompt: "^C",
		EOFPrompt:       "exit",
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "meerkat-client: readline init failed:", err)
		os.Exit(1)
	}
	defer rl.Close()

	for {
		rl.SetPrompt(promptFor(cwd))
		line, err := rl.Readline()
		if err == readline.ErrInterrupt {
			// Ctrl+C on an empty/partial line: bash-style, just start a fresh prompt.
			continue
		}
		if err == io.EOF {
			fmt.Println()
			break // Ctrl+D
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "meerkat-client:", err)
			break
		}
		if strings.TrimSpace(line) == "" {
			continue
		}

		if err := writeFrame(conn, msgLine, []byte(line)); err != nil {
			fmt.Fprintln(os.Stderr, "meerkat-client: lost connection to daemon:", err)
			break
		}

		done := false
		closed := false
		for !done {
			msgType, payload, ok := readFrame(server)
			if !ok {
				closed = true
				break
			}
			var newCwd string
			newCwd, done = processResponseFrame(msgType, payload)
			if newCwd != "" {
				cwd = newCwd
			}
		}
		if closed {
			break // daemon closed the socket (we sent exit/quit)
		}
	}
}

func promptFor(cwd string) string {
	return fmt.Sprintf("meerkat %s> ", shorten(cwd))
}

// processResponseFrame prints one protocol frame and reports whether it was
// the terminating "X" frame for this command. "P" (raw pty output) is
// written straight to stdout as-is — this client doesn't put the local
// terminal into raw mode, so it's not a fully interactive pty experience,
// but foreground command output (including color/formatting a real
// terminal would trigger, like `ls`'s column layout) still displays.
func processResponseFrame(msgType byte, payload []byte) (newCwd string, done bool) {
	switch msgType {
	case msgStdout:
		fmt.Println(string(payload))
	case msgStderr:
		fmt.Fprintln(os.Stderr, string(payload))
	case msgPty:
		os.Stdout.Write(payload)
	case msgCwd:
		newCwd = string(payload)
	case msgExit:
		done = true
	}
	return newCwd, done
}

func shorten(cwd string) string {
	u, err := user.Current()
	if err == nil && strings.HasPrefix(cwd, u.HomeDir) {
		return "~" + strings.TrimPrefix(cwd, u.HomeDir)
	}
	return cwd
}
