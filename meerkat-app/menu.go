package main

import (
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// buildMenu returns the native macOS menu bar. The very first top-level
// submenu is always rendered by Cocoa as *the* app menu — its own Label is
// ignored and replaced with the running app's name — which is what makes
// this the conventional (Cmd+,) home for "Preferences…" rather than
// tucking it under Edit. Wails' menu.AppMenuRole would get us the same
// slot with native About/Hide/Quit items for free, but as an opaque native
// role it can't be extended with our own item, so this builds the app menu
// by hand instead (About/Hide/Services just aren't offered — Quit is,
// since without it there'd be no menu-based way to quit at all).
//
// "Preferences…" doesn't open a second OS window — Wails v2 only really
// supports one — it emits a "preferences:open" event that main.js listens
// for and shows as an in-page overlay (see preferencesOverlay.js), the
// same pattern the Ctrl+M jobs overlay already uses.
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
	root.Append(menu.WindowMenu())

	return root
}
