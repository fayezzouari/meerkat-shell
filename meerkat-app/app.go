package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"meerkat-app/daemonclient"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is bound to the frontend. Every exported method becomes callable
// from JS as window.go.main.App.<MethodName>(...).
//
// One daemon connection per open tab: each tab gets its own
// daemonclient.Client (its own cwd/current-job on the daemon side, since
// meerkat-daemon already gives every accepted socket its own Connection
// process — see socket_server.ex). Sessions are keyed by an id the
// frontend uses to route both requests (SendLine/SendInput/SendResize)
// and daemon events (daemon:line/daemon:pty/daemon:closed) to the right
// tab.
type App struct {
	ctx context.Context

	mu       sync.Mutex
	sessions map[string]*daemonclient.Client
	nextID   int
	daemonUp bool // true once any NewSession call has connected successfully
}

func NewApp() *App {
	return &App{sessions: make(map[string]*daemonclient.Client)}
}

// startup runs once the Wails runtime and window are ready. It does NOT
// open a session itself — see NewSession, which the frontend calls once
// its own event listeners are registered (same reasoning as the old
// single-session Connect: an event emitted before anyone is listening is
// just lost, since Wails events aren't buffered).
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// SessionInfo is what NewSession resolves to in JS: {id, cwd}.
type SessionInfo struct {
	Id  string `json:"id"`
	Cwd string `json:"cwd"`
}

// NewSession opens a new daemon connection for one tab and returns its id
// and initial working directory.
func (a *App) NewSession() (SessionInfo, error) {
	a.mu.Lock()
	spawnIfMissing := !a.daemonUp
	a.mu.Unlock()

	var client *daemonclient.Client
	var err error
	if spawnIfMissing {
		client, err = daemonclient.Connect()
	} else {
		client, err = daemonclient.ConnectExisting()
	}
	if err != nil {
		return SessionInfo{}, err
	}

	cwd := ""
	if msgType, payload, ok := client.ReadFrame(); ok && msgType == daemonclient.MsgCwd {
		cwd = string(payload)
	}

	a.mu.Lock()
	a.nextID++
	id := fmt.Sprintf("s%d", a.nextID)
	a.sessions[id] = client
	a.daemonUp = true
	a.mu.Unlock()

	go a.readLoop(id, client)
	return SessionInfo{Id: id, Cwd: cwd}, nil
}

// CloseSession closes one tab's daemon connection.
func (a *App) CloseSession(id string) string {
	a.mu.Lock()
	client, ok := a.sessions[id]
	delete(a.sessions, id)
	a.mu.Unlock()

	if !ok {
		return "no such session"
	}
	if err := client.Close(); err != nil {
		return err.Error()
	}
	return ""
}

func (a *App) client(id string) *daemonclient.Client {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sessions[id]
}

// readLoop forwards every daemon frame for one session to the frontend,
// tagged with that session's id so the frontend can route it to the right
// tab. "O"/"E"/"D"/"X" keep the old "daemon:line" event with its
// "O:"/"E:"/"D:"/"X:" string prefix (builtin output, cwd changes, exit
// codes — none of which are pty-attached). "P" (raw pty output) gets its
// own event, base64-encoded: it's arbitrary bytes from a subprocess and
// could split a multi-byte UTF-8 character across two chunks, so it isn't
// safe to treat as a JS string without an encoding step.
func (a *App) readLoop(id string, client *daemonclient.Client) {
	for {
		msgType, payload, ok := client.ReadFrame()
		if !ok {
			runtime.EventsEmit(a.ctx, "daemon:closed", map[string]string{"id": id})
			return
		}

		switch msgType {
		case daemonclient.MsgPty:
			runtime.EventsEmit(a.ctx, "daemon:pty", map[string]string{
				"id":   id,
				"data": base64.StdEncoding.EncodeToString(payload),
			})
		case daemonclient.MsgStdout:
			runtime.EventsEmit(a.ctx, "daemon:line", map[string]string{"id": id, "line": "O:" + string(payload)})
		case daemonclient.MsgStderr:
			runtime.EventsEmit(a.ctx, "daemon:line", map[string]string{"id": id, "line": "E:" + string(payload)})
		case daemonclient.MsgCwd:
			runtime.EventsEmit(a.ctx, "daemon:line", map[string]string{"id": id, "line": "D:" + string(payload)})
		case daemonclient.MsgExit:
			runtime.EventsEmit(a.ctx, "daemon:line", map[string]string{"id": id, "line": "X:" + string(payload)})
		}
	}
}

// SendLine is called from JS whenever the user presses Enter while
// composing a command (i.e. no job is currently running) in session `id`.
func (a *App) SendLine(id string, line string) string {
	client := a.client(id)
	if client == nil {
		return "not connected to daemon"
	}
	if err := client.SendLine(line); err != nil {
		return err.Error()
	}
	return ""
}

// SendInput is called from JS for every keystroke while a foreground job
// is running in session `id`, forwarding it raw to the job's pty stdin.
func (a *App) SendInput(id string, data string) string {
	client := a.client(id)
	if client == nil {
		return "not connected to daemon"
	}
	if err := client.SendInput([]byte(data)); err != nil {
		return err.Error()
	}
	return ""
}

// SendResize is called from JS whenever session `id`'s terminal size changes.
func (a *App) SendResize(id string, rows int, cols int) string {
	client := a.client(id)
	if client == nil {
		return "not connected to daemon"
	}
	if err := client.SendResize(uint16(rows), uint16(cols)); err != nil {
		return err.Error()
	}
	return ""
}

// JobInfo is one row of `jobs` output, structured for the sessions/jobs
// overlay (Ctrl+M) rather than as raw terminal text.
type JobInfo struct {
	Id       int    `json:"id"`
	Status   string `json:"status"`
	Cmd      string `json:"cmd"`
	ExitCode *int   `json:"exitCode"`
}

// ListJobs asks the daemon for the current `jobs` table — shared by every
// connection (JobManager is one GenServer, not per-connection — see
// meerkat_daemon/job_manager.ex), so this reflects jobs started from any
// tab, not just whichever one is active. Opens its own short-lived
// connection rather than piggybacking on a visible tab's session, so
// running it doesn't dump "jobs" into anyone's terminal scrollback.
func (a *App) ListJobs() ([]JobInfo, error) {
	client, err := daemonclient.ConnectExisting()
	if err != nil {
		return nil, err
	}
	defer client.Close()

	client.ReadFrame() // discard the initial "D:<cwd>" banner

	if err := client.SendLine("jobs"); err != nil {
		return nil, err
	}

	var jobs []JobInfo
	for {
		msgType, payload, ok := client.ReadFrame()
		if !ok || msgType == daemonclient.MsgExit {
			break
		}
		if msgType == daemonclient.MsgStdout {
			if job, ok := parseJobLine(string(payload)); ok {
				jobs = append(jobs, job)
			}
		}
	}
	return jobs, nil
}

// parseJobLine parses one line of the `jobs` builtin's output:
// "[<id>] <status>[ (exit <code>)]\t<cmd>" — see evaluator.ex's
// builtin("jobs", ...). The no-jobs case ("no jobs", no leading "[") just
// doesn't match and is correctly skipped rather than added as a row.
func parseJobLine(line string) (JobInfo, bool) {
	if !strings.HasPrefix(line, "[") {
		return JobInfo{}, false
	}
	closeBracket := strings.Index(line, "]")
	if closeBracket < 0 {
		return JobInfo{}, false
	}
	id, err := strconv.Atoi(line[1:closeBracket])
	if err != nil {
		return JobInfo{}, false
	}

	rest := strings.TrimPrefix(line[closeBracket+1:], " ")
	tab := strings.IndexByte(rest, '\t')
	if tab < 0 {
		return JobInfo{}, false
	}
	status, cmd := rest[:tab], rest[tab+1:]

	var exitCode *int
	if i := strings.Index(status, " (exit "); i >= 0 {
		codeStr := strings.TrimSuffix(status[i+len(" (exit "):], ")")
		if code, err := strconv.Atoi(codeStr); err == nil {
			exitCode = &code
		}
		status = status[:i]
	}

	return JobInfo{Id: id, Status: status, Cmd: cmd, ExitCode: exitCode}, true
}

func (a *App) shutdown(_ context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, client := range a.sessions {
		client.Close()
	}
}
