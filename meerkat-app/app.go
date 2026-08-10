package main

import (
	"context"
	"strings"

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
// first "D:<cwd>" line can arrive fast enough to race ahead of the
// frontend's listener registration, and Wails events aren't buffered — an
// event emitted before anyone is listening is just lost. Returning the cwd
// directly sidesteps that race entirely.
func (a *App) Connect() (string, error) {
	client, err := daemonclient.Connect()
	if err != nil {
		return "", err
	}
	a.client = client

	line, ok := client.ReadLine()
	cwd := ""
	if ok && strings.HasPrefix(line, "D:") {
		cwd = strings.TrimPrefix(line, "D:")
	}

	go a.readLoop()
	return cwd, nil
}

// readLoop forwards every raw protocol line ("O:...", "E:...", "D:...",
// "X:...") to the frontend as-is. Interpretation stays in JS, next to
// where it turns into terminal output — one place to update if the
// protocol grows.
func (a *App) readLoop() {
	for {
		line, ok := a.client.ReadLine()
		if !ok {
			runtime.EventsEmit(a.ctx, "daemon:closed", nil)
			return
		}
		runtime.EventsEmit(a.ctx, "daemon:line", line)
	}
}

// SendLine is called from JS whenever the user presses Enter.
func (a *App) SendLine(line string) string {
	if a.client == nil {
		return "not connected to daemon"
	}
	if err := a.client.SendLine(line); err != nil {
		return err.Error()
	}
	return ""
}

func (a *App) shutdown(_ context.Context) {
	if a.client != nil {
		a.client.Close()
	}
}
