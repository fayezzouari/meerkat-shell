// meerkat-client is the thin native client for meerkat-daemon. It owns nothing but the
// terminal: reading a line, sending it down a Unix socket, and printing
// whatever comes back. All parsing, execution, and job state live in the
// daemon so this binary starts near-instantly and stays that way even as
// the daemon grows heavier (Oban, erlexec, a TUI job panel, ...).
package main

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

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

	server := bufio.NewScanner(conn)
	stdin := bufio.NewScanner(os.Stdin)
	cwd := "~"

	// Initial "D:" banner sent by the daemon on connect.
	if server.Scan() {
		cwd = handleLine(server.Text(), cwd)
	}

	for {
		fmt.Printf("meerkat %s> ", shorten(cwd))
		if !stdin.Scan() {
			fmt.Println()
			break // Ctrl+D
		}
		line := stdin.Text()

		if _, err := fmt.Fprintln(conn, line); err != nil {
			fmt.Fprintln(os.Stderr, "meerkat-client: lost connection to daemon:", err)
			break
		}

		done := false
		for !done && server.Scan() {
			var newCwd string
			newCwd, done = processResponseLine(server.Text(), cwd)
			if newCwd != "" {
				cwd = newCwd
			}
		}
		if !done && server.Err() == nil {
			break // daemon closed the socket (we sent exit/quit)
		}
	}
}

// handleLine is only used for the very first banner line before the REPL loop starts.
func handleLine(line, cwd string) string {
	if strings.HasPrefix(line, "D:") {
		return strings.TrimPrefix(line, "D:")
	}
	return cwd
}

// processResponseLine prints one protocol line and reports whether it was
// the terminating "X:" line for this command.
func processResponseLine(line, cwd string) (newCwd string, done bool) {
	switch {
	case strings.HasPrefix(line, "O:"):
		fmt.Println(strings.TrimPrefix(line, "O:"))
	case strings.HasPrefix(line, "E:"):
		fmt.Fprintln(os.Stderr, strings.TrimPrefix(line, "E:"))
	case strings.HasPrefix(line, "D:"):
		newCwd = strings.TrimPrefix(line, "D:")
	case strings.HasPrefix(line, "X:"):
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
