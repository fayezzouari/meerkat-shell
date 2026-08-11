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
		// WindowIsTranslucent is what makes the background-opacity setting
		// (Preferences → Appearance) possible at all: it installs an
		// NSVisualEffectView behind the webview, and WebviewIsTransparent
		// lets the page's own transparency reach it. Wails never calls
		// setOpaque:NO on the window itself, so this vibrancy path is the
		// only supported way to see anything behind the window — meaning
		// "transparent" here reads as macOS frosted glass, not clear glass.
		//
		// Both are window-creation flags and can't be toggled later, so
		// they're always on; opacity is then purely a matter of what the
		// page paints (see appearance.js). At 100% the surfaces are fully
		// opaque and nothing shows through, which is the default.
		//
		// Mac must also stay non-nil for the green zoom button — see the
		// zoomable note in Wails' window.go.
		Mac: &mac.Options{
			WindowIsTranslucent:  true,
			WebviewIsTransparent: true,
		},
		// Fully transparent: every visible surface is painted by the page,
		// so the window must not lay down an opaque colour underneath.
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
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
