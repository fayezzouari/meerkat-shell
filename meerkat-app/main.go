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
		// Must stay non-nil: Wails only computes the window's `zoomable`
		// flag inside its `if options.Mac != nil` branch, so leaving it
		// unset disables the green zoom button.
		//
		// The two flags are what make the background-opacity setting
		// possible — an NSVisualEffectView behind the webview, which the
		// page's own transparency reaches. They're window-creation flags
		// and can't be toggled later, so they're always on; opacity is
		// purely what the page paints (see appearance.js).
		Mac: &mac.Options{
			WindowIsTranslucent:  true,
			WebviewIsTransparent: true,
		},
		// Every visible surface is painted by the page, so the window must
		// not lay down an opaque colour underneath.
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
		// A programmatically-created NSWindow only gets
		// NSWindowCollectionBehaviorFullScreenPrimary if it starts
		// fullscreen. app.startup drops straight back to windowed, which
		// keeps the capability for the rest of the session.
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
