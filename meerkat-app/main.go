package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "Meerkat",
		Width:  1000,
		Height: 650,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Menu: buildMenu(app),
		// Must be non-nil even though every field is left at its default:
		// Wails only computes the window's `zoomable` flag inside its
		// `if options.Mac != nil` branch (internal/frontend/desktop/darwin/
		// window.go), so leaving Mac unset leaves zoomable=false, and
		// WailsContext.m then explicitly does [button setEnabled:NO] on the
		// green zoom button. An empty struct means DisableZoom stays false
		// and the button is left enabled, which is what we want.
		Mac: &mac.Options{},
		// A programmatically-created NSWindow never gets
		// NSWindowCollectionBehaviorFullScreenPrimary unless it's told to
		// start fullscreen — there's no Wails option to just grant that
		// behavior directly. Starting fullscreen then immediately dropping
		// back to windowed (see app.startup) attaches it permanently for
		// the rest of the session, which is what makes the green
		// traffic-light button and the Cmd+Ctrl+F shortcut work at all.
		WindowStartState: options.Fullscreen,
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
