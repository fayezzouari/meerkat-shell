import { createSessionManager } from "./js/sessionManager.js";
import { createJobsOverlay } from "./js/jobsOverlay.js";
import { createPreferencesOverlay } from "./js/preferencesOverlay.js";
import { applyTheme, getThemeId } from "./js/themes.js";

// Before anything renders: index.html's :root only carries the default
// preset's values, so this is what swaps in the user's saved pick (and is
// a no-op re-apply if they're on the default).
applyTheme(getThemeId());

const sessionManager = createSessionManager({
  tabBarEl: document.getElementById("tabbar"),
  panesEl: document.getElementById("panes"),
});

const overlay = createJobsOverlay(sessionManager);
sessionManager.setOverlayToggle(() => overlay.toggle());

const preferences = createPreferencesOverlay();
// Emitted by main.go's native "Preferences…" menu item — see menu.go.
window.runtime.EventsOn("preferences:open", () => preferences.open());

sessionManager.newTab();
