import { createSessionManager } from "./js/sessionManager.js";
import { createSidebar } from "./js/sidebar.js";
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

const sidebar = createSidebar(sessionManager);
sessionManager.setSidebarToggle(() => sidebar.toggle());
// The sidebar lists panes, so it has to follow along as they're created,
// closed, or focused — otherwise it only catches up on its 2s poll.
sessionManager.setOnLayoutChange(() => sidebar.refresh());

const preferences = createPreferencesOverlay();
// Emitted by main.go's native "Preferences…" menu item — see menu.go.
window.runtime.EventsOn("preferences:open", () => preferences.open());

sessionManager.newTab();
