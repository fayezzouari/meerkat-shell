import { createSessionManager } from "./js/sessionManager.js";
import { createJobsOverlay } from "./js/jobsOverlay.js";

const sessionManager = createSessionManager({
  tabBarEl: document.getElementById("tabbar"),
  panesEl: document.getElementById("panes"),
});

const overlay = createJobsOverlay(sessionManager);
sessionManager.setOverlayToggle(() => overlay.toggle());

sessionManager.newTab();
