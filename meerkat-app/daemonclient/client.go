// Package daemonclient wraps the connect-or-spawn-then-connect logic shared
// between meerkat-client (terminal REPL) and meerkat-app (GUI). Kept free of
// any GUI framework import so it can be unit tested on its own.
package daemonclient

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"syscall"
	"time"
)

type Client struct {
	conn    net.Conn
	scanner *bufio.Scanner
}

func SocketPath() string {
	if p := os.Getenv("MEERKAT_SOCK"); p != "" {
		return p
	}
	u, err := user.Current()
	if err != nil {
		return "/tmp/meerkat.sock"
	}
	return filepath.Join(u.HomeDir, ".meerkat", "meerkat.sock")
}

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

// Connect dials the daemon, spawning it detached first if nothing answers.
// Identical behavior to meerkat-client's ensureDaemon — same env vars,
// same 8s window, same log file convention — so both frontends feel
// consistent about daemon lifecycle.
func Connect() (*Client, error) {
	path := SocketPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("cannot create %s: %w", filepath.Dir(path), err)
	}

	if conn, err := dial(path); err == nil {
		return wrap(conn), nil
	}

	cmdStr, dir := startCmd()
	cmd := exec.Command("sh", "-c", cmdStr)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	logPath := filepath.Join(filepath.Dir(path), "daemon.log")
	if logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); err == nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start daemon: %w", err)
	}

	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if conn, err := dial(path); err == nil {
			return wrap(conn), nil
		}
		time.Sleep(150 * time.Millisecond)
	}
	return nil, fmt.Errorf("daemon did not come up within 8s (check %s)", logPath)
}

func wrap(conn net.Conn) *Client {
	return &Client{conn: conn, scanner: bufio.NewScanner(conn)}
}

// SendLine writes one line of shell input to the daemon.
func (c *Client) SendLine(line string) error {
	_, err := fmt.Fprintln(c.conn, line)
	return err
}

// ReadLine blocks for the next raw protocol line ("O:...", "E:...",
// "D:...", or "X:..."). Returns ok=false once the connection is closed.
func (c *Client) ReadLine() (line string, ok bool) {
	if !c.scanner.Scan() {
		return "", false
	}
	return c.scanner.Text(), true
}

func (c *Client) Close() error {
	return c.conn.Close()
}
