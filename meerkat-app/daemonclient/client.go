// Package daemonclient wraps the connect-or-spawn-then-connect logic shared
// between meerkat-client and meerkat-app.
package daemonclient

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
	"syscall"
	"time"
)

// Wire protocol: 4-byte big-endian length prefix, then a payload whose first
// byte is a type tag — meerkat-daemon's `packet: 4` socket. Framed rather than
// line-delimited because pty output can't safely be split on "\n".
const (
	MsgLine   = 'L' // client -> daemon: one full command line
	MsgInput  = 'I' // client -> daemon: raw bytes for the running job's pty stdin
	MsgResize = 'R' // client -> daemon: <<rows::16, cols::16>>
	MsgKill   = 'K' // client -> daemon: terminate the current foreground job
	MsgStdout = 'O' // daemon -> client: builtin stdout text
	MsgStderr = 'E' // daemon -> client: builtin stderr text
	MsgCwd    = 'D' // daemon -> client: cwd (initial, and after `cd`)
	MsgPty    = 'P' // daemon -> client: raw pty output, unbuffered
	MsgExit   = 'X' // daemon -> client: command complete, exit code as text
)

type Client struct {
	conn net.Conn
	r    *bufio.Reader
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

// ConnectExisting dials without Connect's spawn-if-missing logic, for callers
// that already know the daemon is up. Spawning on every connection would risk
// two callers racing to start `mix run`.
func ConnectExisting() (*Client, error) {
	conn, err := dial(SocketPath())
	if err != nil {
		return nil, err
	}
	return wrap(conn), nil
}

// Connect dials the daemon, spawning it detached first if nothing answers.
// Mirrors meerkat-client's ensureDaemon.
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
	return &Client{conn: conn, r: bufio.NewReader(conn)}
}

func (c *Client) writeFrame(msgType byte, payload []byte) error {
	frame := make([]byte, 4+1+len(payload))
	binary.BigEndian.PutUint32(frame[:4], uint32(1+len(payload)))
	frame[4] = msgType
	copy(frame[5:], payload)
	_, err := c.conn.Write(frame)
	return err
}

// SendLine writes one line of shell input to the daemon.
func (c *Client) SendLine(line string) error {
	return c.writeFrame(MsgLine, []byte(line))
}

// SendInput forwards raw bytes to the foreground job's pty stdin.
func (c *Client) SendInput(data []byte) error {
	return c.writeFrame(MsgInput, data)
}

// Kill terminates the foreground job: SIGTERM escalating to SIGKILL, like the
// `kill <id>` builtin. A no-op if no job is running.
func (c *Client) Kill() error {
	return c.writeFrame(MsgKill, nil)
}

// SendResize tells the daemon the client's terminal dimensions changed.
func (c *Client) SendResize(rows, cols uint16) error {
	payload := make([]byte, 4)
	binary.BigEndian.PutUint16(payload[0:2], rows)
	binary.BigEndian.PutUint16(payload[2:4], cols)
	return c.writeFrame(MsgResize, payload)
}

// ReadFrame blocks for the next protocol frame (see the Msg* constants).
// Returns ok=false once the connection is closed.
func (c *Client) ReadFrame() (msgType byte, payload []byte, ok bool) {
	var lenBuf [4]byte
	if _, err := io.ReadFull(c.r, lenBuf[:]); err != nil {
		return 0, nil, false
	}
	n := binary.BigEndian.Uint32(lenBuf[:])
	if n == 0 {
		return 0, nil, false
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(c.r, buf); err != nil {
		return 0, nil, false
	}
	return buf[0], buf[1:], true
}

func (c *Client) Close() error {
	return c.conn.Close()
}
