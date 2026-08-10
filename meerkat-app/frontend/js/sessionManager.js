import { createSession } from "./session.js";

// Owns the set of open tabs: the tab bar DOM, which pane is visible, and
// creating/closing sessions. Each tab is one createSession() instance (its
// own Terminal + daemon connection) mounted into its own <div class="pane">
// under `panesEl`; only the active tab's pane is shown.
export function createSessionManager({ tabBarEl, panesEl }) {
  const sessions = []; // { id, session, paneEl, tabEl }
  let activeId = null;
  let onToggleOverlay = () => {};

  function setOverlayToggle(fn) {
    onToggleOverlay = fn;
  }

  // Only the visible pane needs to be kept in sync with the window size —
  // hidden tabs get refitted by switchTo() when they're shown instead, so
  // resizing while they're in the background wouldn't matter anyway.
  window.addEventListener("resize", () => {
    activeSession()?.fit();
  });

  function findEntry(id) {
    return sessions.find((s) => s.id === id);
  }

  function activeSession() {
    return findEntry(activeId)?.session;
  }

  // Short tab label — the cwd's last path segment (e.g. "meerkat" for
  // /Users/fayez/projects/meerkat, "fayez" for /Users/fayez). Doesn't need
  // to be globally unique; it's a hint, not an identifier.
  function labelFor(cwd) {
    return cwd.split("/").filter(Boolean).pop() || "/";
  }

  function renderTabBar() {
    tabBarEl.innerHTML = "";
    sessions.forEach((entry, index) => {
      const tab = document.createElement("div");
      tab.className = "tab" + (entry.id === activeId ? " active" : "");

      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = `${index + 1} ${labelFor(entry.session.getCwd())}`;
      tab.appendChild(label);

      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        closeTab(entry.id);
      });
      tab.appendChild(close);

      tab.addEventListener("click", () => switchTo(entry.id));
      tabBarEl.appendChild(tab);
      entry.tabEl = tab;
    });
  }

  async function newTab() {
    const paneEl = document.createElement("div");
    paneEl.className = "pane";
    panesEl.appendChild(paneEl);

    const inheritCwd = activeSession()?.getCwd();

    const session = await createSession({
      container: paneEl,
      initialCwd: inheritCwd,
      onNewTabRequested: () => newTab(),
      onToggleOverlayRequested: () => onToggleOverlay(),
      onSessionEnded: (id) => handleSessionEnded(id),
    });

    sessions.push({ id: session.id, session, paneEl });
    switchTo(session.id);
  }

  function switchTo(id) {
    const entry = findEntry(id);
    if (!entry) return;

    for (const s of sessions) {
      s.paneEl.style.display = s.id === id ? "block" : "none";
    }
    activeId = id;

    // A display:none xterm.js instance can miscompute layout; re-fitting
    // on becoming visible again is cheap insurance against that.
    entry.session.fit();
    entry.session.focus();
    renderTabBar();
  }

  function closeTab(id) {
    if (sessions.length <= 1) return; // always keep at least one tab open
    const index = sessions.findIndex((s) => s.id === id);
    if (index === -1) return;

    const [entry] = sessions.splice(index, 1);
    entry.session.dispose();
    entry.paneEl.remove();

    if (activeId === id) {
      const next = sessions[Math.max(0, index - 1)];
      switchTo(next.id);
    } else {
      renderTabBar();
    }
  }

  // The daemon connection for tab `id` closed — typing `exit`/`quit`, the
  // daemon dying, whatever. Same as a real terminal: the tab whose shell
  // just ended closes immediately, and if it was the last one, the whole
  // app quits rather than leaving an empty window with no tabs.
  function handleSessionEnded(id) {
    if (sessions.length <= 1) {
      window.runtime.Quit();
      return;
    }
    closeTab(id);
  }

  function list() {
    return sessions.map((s) => ({ id: s.id, cwd: s.session.getCwd() }));
  }

  return { newTab, switchTo, closeTab, list, activeId: () => activeId, setOverlayToggle };
}
