package main

import (
	"context"
	"encoding/base64"

	"meerkat-app/daemonclient"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is bound to the frontend. Every exported method becomes callable
// from JS as window.go.main.App.<MethodName>(...).
type App struct {
	ctx    context.Context
	client *daemonclient.Client
}

func NewApp() *App {
	return &App{}
}

// startup runs once the Wails runtime and window are ready. It does NOT
// connect to the daemon — see Connect, which the frontend calls once its
// own event listeners are registered.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Connect dials (or lazily spawns) meerkat-daemon and returns the initial
// working directory. Called from JS after window.runtime.EventsOn listeners
// are attached, rather than connecting eagerly from startup: the daemon's
// first "D:<cwd>" frame can arrive fast enough to race ahead of the
// frontend's listener registration, and Wails events aren't buffered — an
// event emitted before anyone is listening is just lost. Returning the cwd
// directly sidesteps that race entirely.
func (a *App) Connect() (string, error) {
	client, err := daemonclient.Connect()
	if err != nil {
		return "", err
	}
	a.client = client

	cwd := ""
	if msgType, payload, ok := client.ReadFrame(); ok && msgType == daemonclient.MsgCwd {
		cwd = string(payload)
	}

	go a.readLoop()
	return cwd, nil
}

// readLoop forwards every daemon frame to the frontend. "O"/"E"/"D"/"X"
// keep the old "daemon:line" event with its "O:"/"E:"/"D:"/"X:" string
// prefix (used for builtin output, cwd changes, and exit codes — none of
// which are pty-attached). "P" (raw pty output) gets its own event,
// base64-encoded: it's arbitrary bytes from a subprocess and could split a
// multi-byte UTF-8 character across two chunks, so it isn't safe to treat
// as a JS string without an encoding step.
func (a *App) readLoop() {
	for {
		msgType, payload, ok := a.client.ReadFrame()
		if !ok {
			runtime.EventsEmit(a.ctx, "daemon:closed", nil)
			return
		}

		switch msgType {
		case daemonclient.MsgPty:
			runtime.EventsEmit(a.ctx, "daemon:pty", base64.StdEncoding.EncodeToString(payload))
		case daemonclient.MsgStdout:
			runtime.EventsEmit(a.ctx, "daemon:line", "O:"+string(payload))
		case daemonclient.MsgStderr:
			runtime.EventsEmit(a.ctx, "daemon:line", "E:"+string(payload))
		case daemonclient.MsgCwd:
			runtime.EventsEmit(a.ctx, "daemon:line", "D:"+string(payload))
		case daemonclient.MsgExit:
			runtime.EventsEmit(a.ctx, "daemon:line", "X:"+string(payload))
		}
	}
}

// SendLine is called from JS whenever the user presses Enter while
// composing a command (i.e. no job is currently running).
func (a *App) SendLine(line string) string {
	if a.client == nil {
		return "not connected to daemon"
	}
	if err := a.client.SendLine(line); err != nil {
		return err.Error()
	}
	return ""
}

// SendInput is called from JS for every keystroke while a foreground job
// is running, forwarding it raw to the job's pty stdin.
func (a *App) SendInput(data string) string {
	if a.client == nil {
		return "not connected to daemon"
	}
	if err := a.client.SendInput([]byte(data)); err != nil {
		return err.Error()
	}
	return ""
}

// SendResize is called from JS whenever the terminal's size changes.
func (a *App) SendResize(rows int, cols int) string {
	if a.client == nil {
		return "not connected to daemon"
	}
	if err := a.client.SendResize(uint16(rows), uint16(cols)); err != nil {
		return err.Error()
	}
	return ""
}

func (a *App) shutdown(_ context.Context) {
	if a.client != nil {
		a.client.Close()
	}
}
