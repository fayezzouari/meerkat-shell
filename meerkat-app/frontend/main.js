import { createSessionManager } from "./js/sessionManager.js";
import { createJobsOverlay } from "./js/jobsOverlay.js";
import { createPreferencesOverlay } from "./js/preferencesOverlay.js";

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
