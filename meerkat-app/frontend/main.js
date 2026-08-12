import { createSessionManager } from "./js/sessionManager.js";
import { createSidebar } from "./js/sidebar.js";
import { createPreferencesOverlay } from "./js/preferencesOverlay.js";
import { applyTheme, getThemeId } from "./js/themes.js";
import { initAppearance } from "./js/appearance.js";
import { initWorktrees } from "./js/worktrees.js";

// index.html's :root only carries the default preset; swap in the saved pick
// before anything renders.
applyTheme(getThemeId());

// Awaited before the first tab: a Terminal built before this resolves gets
// the wrong font and has to be restyled and refitted a frame later.
await initAppearance();

// Synchronous: the sidebar reads the worktree directory preference on its
// first refresh, which can happen before any await here resolves.
initWorktrees();

const sessionManager = createSessionManager({
  tabBarEl: document.getElementById("tabbar"),
  panesEl: document.getElementById("panes"),
});

const sidebar = createSidebar(sessionManager);
sessionManager.setSidebarToggle(() => sidebar.toggle());
// Otherwise the pane list only catches up on the sidebar's 2s poll.
sessionManager.setOnLayoutChange(() => sidebar.refresh());

const preferences = createPreferencesOverlay();
// Emitted by the native "Preferences…" menu item — see menu.go.
window.runtime.EventsOn("preferences:open", () => preferences.open());

sessionManager.newTab();
