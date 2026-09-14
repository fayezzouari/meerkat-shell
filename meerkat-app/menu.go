package main

import (
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// buildMenu returns the native macOS menu bar. Cocoa renders the first
// top-level submenu as the app menu regardless of its label. Built by hand
// rather than with menu.AppMenuRole, which is an opaque native role that
// can't be extended with our own "Preferences…" item.
//
// Preferences emits an event rather than opening a second OS window, which
// Wails v2 doesn't really support.
func buildMenu(app *App) *menu.Menu {
	root := menu.NewMenu()

	appMenu := root.AddSubmenu("Meerkat")
	appMenu.AddText("Preferences…", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "preferences:open")
	})
	appMenu.AddSeparator()
	appMenu.AddText("Quit Meerkat", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(app.ctx)
	})

	root.Append(menu.EditMenu())

	// Mirrors the keyboard shortcuts (keymap.js), which are remappable; the
	// accelerators shown here are the defaults. Both emit events rather than
	// touching the DOM, since the panels live in the webview.
	viewMenu := root.AddSubmenu("View")
	viewMenu.AddText("Toggle Sidebar", keys.CmdOrCtrl("b"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "sidebar:toggle")
	})
	viewMenu.AddText("Toggle Source Control (Beta)", keys.CmdOrCtrl("g"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "vcs:toggle")
	})
	viewMenu.AddSeparator()
	viewMenu.AddText("Zoom In", keys.CmdOrCtrl("="), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "zoom:in")
	})
	viewMenu.AddText("Zoom Out", keys.CmdOrCtrl("-"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "zoom:out")
	})
	viewMenu.AddText("Actual Size", keys.CmdOrCtrl("0"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "zoom:reset")
	})

	root.Append(menu.WindowMenu())

	return root
}
