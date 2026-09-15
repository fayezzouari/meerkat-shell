// meerkat-client is the thin native client for meerkat-daemon: it reads a
// line, sends it down a Unix socket, and prints what comes back. All parsing,
// execution, and job state live in the daemon.
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

// Mirrors MeerkatDaemon.Evaluator's @builtins, for completion only.
var builtins = []string{"cd", "exit", "quit", "jobs", "fg", "bg", "kill", "stop", "engine"}

// Wire protocol: 4-byte big-endian length prefix, then a payload whose first
// byte is a type tag — meerkat-daemon's `packet: 4` socket. This client speaks
// the framing but never puts the local terminal into raw mode or forwards
// keystrokes to a job's pty, so full-screen programs aren't usable from here.
const (
	msgLine   = 'L'
	msgStdout = 'O'
	msgStderr = 'E'
	msgCwd    = 'D'
	msgHello  = 'H' // which engine answered, right after the first cwd
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

// socketPath is where this client expects its engine. Beside an engine — the
// release layout, where meerkat-cli and engine/ share a directory — that is
// meerkat.sock. A `go run` from a checkout has no engine beside it and uses
// dev.sock, where `mix run` listens, so a developer's client and their
// installed one never meet on the same path. MEERKAT_SOCK overrides both.
func socketPath() string {
	if p := os.Getenv("MEERKAT_SOCK"); p != "" {
		return p
	}
	u, err := user.Current()
	if err != nil {
		return "/tmp/meerkat.sock"
	}
	name := "dev.sock"
	if besideEngine() || os.Getenv("MEERKAT_START_CMD") != "" {
		name = "meerkat.sock"
	}
	return filepath.Join(u.HomeDir, ".meerkat", name)
}

func besideEngine() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	_, err = os.Stat(filepath.Join(filepath.Dir(exe), "engine", "bin", "meerkat_daemon"))
	return err == nil
}

// probe connects without starting anything and prints what answers: the
// engine's identity line, or nothing. Exit 0 if something is listening. This
// is what the meerkat-engine wrapper asks before it dares remove a socket.
func probe(path string) int {
	conn, err := dial(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "meerkat-client: nothing is listening on", path)
		return 1
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(2 * time.Second))
	r := bufio.NewReader(conn)
	for i := 0; i < 4; i++ {
		msgType, payload, ok := readFrame(r)
		if !ok {
			break
		}
		if msgType == msgHello {
			fmt.Println(string(payload))
			return 0
		}
	}
	fmt.Println("an engine is listening on", path, "but did not identify itself (older version)")
	return 0
}

func historyPath() string {
	u, err := user.Current()
	if err != nil {
		return ""
	}
	return filepath.Join(u.HomeDir, ".meerkat", "history")
}

// Override MEERKAT_START_CMD to launch a built release instead of `mix run`.
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
	// Told which socket in so many words: the engine's own default depends on
	// how it was built, and a release derives its node name from the path.
	cmd.Env = append(os.Environ(), "MEERKAT_SOCK="+path)
	// New session, no controlling terminal, so the daemon outlives this
	// client and survives Ctrl+C in the shell tab.
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
	if len(os.Args) > 1 && os.Args[1] == "--probe" {
		os.Exit(probe(path))
	}
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

	// Initial "D" banner sent on connect.
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
			break // daemon closed the socket
		}
		// The daemon answers `exit` with X 0 and then closes; without this the
		// prompt would come back once more and only the next line's failed
		// read would end the loop.
		switch strings.TrimSpace(line) {
		case "exit", "quit":
			return
		}
	}
}

func promptFor(cwd string) string {
	return fmt.Sprintf("meerkat %s> ", shorten(cwd))
}

// processResponseFrame prints one frame and reports whether it was the
// terminating "X" frame for this command.
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
