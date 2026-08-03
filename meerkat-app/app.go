package main

import (
	"context"

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

// startup runs once the Wails runtime and window are ready. Connects to
// (or lazily spawns) meerkat-daemon exactly like meerkat-client does.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	client, err := daemonclient.Connect()
	if err != nil {
		runtime.EventsEmit(ctx, "daemon:error", err.Error())
		return
	}
	a.client = client

	go a.readLoop()
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
