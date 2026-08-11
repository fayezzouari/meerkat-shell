import { createSession } from "./session.js";
import { eachLeaf, leavesOf, findLeaf, replaceLeaf, removeLeaf } from "./splitTree.js";

// Owns the open tabs and, within each tab, the split layout: the tab bar
// DOM, which tab is visible, which pane has focus, and creating/closing
// sessions.
//
// Each tab holds a binary split tree rather than a single pane, because
// Cmd+D (split right) and Cmd+Shift+D (split down) compose — splitting one
// half of an existing split has to nest, which a flat list of panes can't
// represent. Nodes are:
//
//   leaf   { type: "leaf", id, session, paneEl }
//   split  { type: "split", dir: "row" | "column", a, b, fraction }
//
// `fraction` is how much of the split's main axis child `a` gets (child
// `b` takes the rest), which is what the draggable divider between them
// adjusts. A tab with no splits is just a bare leaf as its root.
//
// Every leaf owns a persistent paneEl that its Terminal was opened into.
// Re-rendering a tab's layout re-appends those same elements rather than
// rebuilding them, so splitting/closing never destroys a live terminal —
// the DOM move changes the pane's size, and session.js's ResizeObserver
// refits it from there.
export function createSessionManager({ tabBarEl, panesEl }) {
  const tabs = []; // { id, rootEl, root, activeLeafId }
  let activeTabId = null;
  let nextTabId = 1;
  let onToggleSidebar = () => {};
  let onLayoutChange = () => {};

  function setSidebarToggle(fn) {
    onToggleSidebar = fn;
  }

  // Called whenever the set of panes or which one is focused changes, so
  // the sidebar's pane list can follow along instead of waiting for its
  // next poll. Routed through renderTabBar, which every one of those
  // mutations already calls.
  function setOnLayoutChange(fn) {
    onLayoutChange = fn;
  }

  // --- tab/leaf lookup -------------------------------------------------

  function findTab(tabId) {
    return tabs.find((t) => t.id === tabId);
  }

  function activeTab() {
    return findTab(activeTabId);
  }

  // Which tab contains the session `sessionId`, if any.
  function tabOfSession(sessionId) {
    return tabs.find((t) => findLeaf(t.root, sessionId));
  }

  function activeLeaf() {
    const tab = activeTab();
    return tab ? findLeaf(tab.root, tab.activeLeafId) : null;
  }

  function activeSession() {
    return activeLeaf()?.session;
  }

  // --- rendering -------------------------------------------------------

  // Rebuilds one tab's DOM from its tree. Panes are moved, not recreated
  // (see the module comment); everything else — split containers and
  // dividers — is disposable scaffolding rebuilt each time.
  function renderTab(tab) {
    tab.rootEl.innerHTML = "";
    if (!tab.root) return;
    tab.rootEl.appendChild(buildNode(tab, tab.root));
    updateFocusRing(tab);
  }

  function buildNode(tab, node) {
    if (node.type === "leaf") {
      node.paneEl.className = "pane";
      return node.paneEl;
    }

    const el = document.createElement("div");
    el.className = `split split-${node.dir}`;

    const aWrap = document.createElement("div");
    aWrap.className = "split-child";
    aWrap.style.flex = `${node.fraction} 1 0`;
    aWrap.appendChild(buildNode(tab, node.a));

    const divider = document.createElement("div");
    divider.className = `divider divider-${node.dir}`;
    attachDividerDrag(divider, el, node, tab);

    const bWrap = document.createElement("div");
    bWrap.className = "split-child";
    bWrap.style.flex = `${1 - node.fraction} 1 0`;
    bWrap.appendChild(buildNode(tab, node.b));

    el.append(aWrap, divider, bWrap);
    return el;
  }

  // Dragging a divider only rewrites the two flex-basis values in place —
  // no re-render, so the terminals on either side aren't reparented
  // mid-drag (which would blow away xterm's canvas every mousemove). The
  // ResizeObserver in session.js picks up the new sizes and refits.
  function attachDividerDrag(divider, splitEl, node, tab) {
    divider.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const horizontal = node.dir === "row";
      const rect = splitEl.getBoundingClientRect();
      const total = horizontal ? rect.width : rect.height;
      if (total <= 0) return;

      const onMove = (e) => {
        const pos = horizontal ? e.clientX - rect.left : e.clientY - rect.top;
        // Clamped so a pane can't be dragged to nothing — below roughly
        // this, xterm has no rows/cols left to render and fit() starts
        // proposing degenerate sizes.
        node.fraction = Math.min(0.9, Math.max(0.1, pos / total));
        splitEl.children[0].style.flex = `${node.fraction} 1 0`;
        splitEl.children[2].style.flex = `${1 - node.fraction} 1 0`;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.classList.remove("dragging-divider");
      };
      document.body.classList.add("dragging-divider");
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  // The focus ring only appears once a tab actually has more than one
  // pane — with a single pane there's nothing to disambiguate, and an
  // outline around the whole terminal would just be noise.
  function updateFocusRing(tab) {
    const leaves = leavesOf(tab.root);
    leaves.forEach((leaf) => {
      leaf.paneEl.classList.toggle("pane-focused", leaves.length > 1 && leaf.id === tab.activeLeafId);
    });
  }

  function renderTabBar() {
    tabBarEl.innerHTML = "";
    tabs.forEach((tab, index) => {
      const tabEl = document.createElement("div");
      tabEl.className = "tab" + (tab.id === activeTabId ? " active" : "");

      const leaf = findLeaf(tab.root, tab.activeLeafId) || leavesOf(tab.root)[0];
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = `${index + 1} ${labelFor(leaf?.session.getCwd() || "")}`;
      tabEl.appendChild(label);

      // Split count, so a tab with panes hidden behind it still says so.
      const paneCount = leavesOf(tab.root).length;
      if (paneCount > 1) {
        const badge = document.createElement("span");
        badge.className = "tab-badge";
        badge.textContent = paneCount;
        tabEl.appendChild(badge);
      }

      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        closeTab(tab.id);
      });
      tabEl.appendChild(close);

      tabEl.addEventListener("click", () => switchToTab(tab.id));
      tabBarEl.appendChild(tabEl);
    });

    onLayoutChange();
  }

  // Short tab label — the cwd's last path segment (e.g. "meerkat" for
  // /Users/fayez/projects/meerkat, "fayez" for /Users/fayez). Doesn't need
  // to be globally unique; it's a hint, not an identifier.
  function labelFor(cwd) {
    return cwd.split("/").filter(Boolean).pop() || "/";
  }

  // --- creating sessions -----------------------------------------------

  // One place that knows how to wire a new session's callbacks back to
  // this module, used for both "new tab" and "split the current pane".
  async function spawnLeaf({ initialCwd }) {
    const paneEl = document.createElement("div");
    paneEl.className = "pane";

    const session = await createSession({
      container: paneEl,
      initialCwd,
      onNewTabRequested: () => newTab(),
      onToggleSidebarRequested: () => onToggleSidebar(),
      onSplitRequested: (dir) => splitActive(dir),
      onSessionEnded: (id) => handleSessionEnded(id),
    });

    const leaf = { type: "leaf", id: session.id, session, paneEl };
    // Clicking anywhere in a pane focuses it — the same "click to focus"
    // every split-pane terminal has. mousedown rather than click so the
    // focus ring moves on press, before any text selection drag starts.
    paneEl.addEventListener("mousedown", () => focusLeaf(session.id));
    return leaf;
  }

  async function newTab() {
    const inheritCwd = activeSession()?.getCwd();
    const rootEl = document.createElement("div");
    rootEl.className = "tab-pane-root";
    panesEl.appendChild(rootEl);

    const tab = { id: `tab-${nextTabId++}`, rootEl, root: null, activeLeafId: null };
    tabs.push(tab);

    let leaf;
    try {
      leaf = await spawnLeaf({ initialCwd: inheritCwd });
    } catch (err) {
      // Without this the promise just rejects into nothing and the window
      // stays blank forever, with the real reason only visible in
      // ~/.meerkat/daemon.log. The daemon failing to start is the common
      // case (a stale socket, or `mix run` spawned outside the project
      // directory), so say so and offer a retry rather than dying silently.
      showTabError(tab, err);
      switchToTab(tab.id);
      return;
    }
    tab.root = leaf;
    tab.activeLeafId = leaf.id;

    renderTab(tab);
    switchToTab(tab.id);
  }

  function showTabError(tab, err) {
    tab.rootEl.innerHTML = "";
    const box = document.createElement("div");
    box.className = "pane-error";
    box.innerHTML = `
      <div class="pane-error-title">Can't reach the meerkat daemon</div>
      <div class="pane-error-detail"></div>
      <div class="pane-error-hint">
        Start it with <code>./launch.sh</code>, or from
        <code>meerkat-daemon/</code> run <code>mix run --no-halt</code>.
        Details are logged to <code>~/.meerkat/daemon.log</code>.
      </div>
    `;
    box.querySelector(".pane-error-detail").textContent = String(err?.message || err || "unknown error");

    const retry = document.createElement("button");
    retry.className = "prefs-btn";
    retry.textContent = "Retry";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      retry.textContent = "Connecting…";
      try {
        const leaf = await spawnLeaf({});
        tab.root = leaf;
        tab.activeLeafId = leaf.id;
        renderTab(tab);
        renderTabBar();
        leaf.session.focus();
      } catch (e) {
        retry.disabled = false;
        retry.textContent = "Retry";
        box.querySelector(".pane-error-detail").textContent = String(e?.message || e);
      }
    });
    box.appendChild(retry);
    tab.rootEl.appendChild(box);
  }

  // Splits the focused pane, putting the new session to its right
  // ("row") or below it ("column"). The new pane inherits the cwd of the
  // pane it was split from, the way a new tab inherits the active tab's.
  async function splitActive(dir) {
    const tab = activeTab();
    const leaf = activeLeaf();
    if (!tab || !leaf) return;

    const newLeaf = await spawnLeaf({ initialCwd: leaf.session.getCwd() });
    tab.root = replaceLeaf(tab.root, leaf.id, {
      type: "split",
      dir,
      a: leaf,
      b: newLeaf,
      fraction: 0.5,
    });
    tab.activeLeafId = newLeaf.id;

    renderTab(tab);
    renderTabBar();
    newLeaf.session.focus();
  }

  // --- focus / switching -----------------------------------------------

  function focusLeaf(sessionId) {
    const tab = tabOfSession(sessionId);
    if (!tab) return;
    if (tab.id !== activeTabId) switchToTab(tab.id, { focus: false });
    tab.activeLeafId = sessionId;
    updateFocusRing(tab);
    renderTabBar();
    findLeaf(tab.root, sessionId)?.session.focus();
  }

  function switchToTab(tabId, { focus = true } = {}) {
    const tab = findTab(tabId);
    if (!tab) return;

    for (const t of tabs) {
      t.rootEl.style.display = t.id === tabId ? "flex" : "none";
    }
    activeTabId = tabId;

    // A display:none xterm.js instance can miscompute layout; re-fitting
    // every pane in the tab on becoming visible is cheap insurance.
    eachLeaf(tab.root, (leaf) => leaf.session.fit());
    if (focus) findLeaf(tab.root, tab.activeLeafId)?.session.focus();
    renderTabBar();
  }

  // Public switchTo takes a *session* id (that's what the jobs overlay
  // lists), and focuses that pane, switching tabs if it lives elsewhere.
  function switchTo(sessionId) {
    focusLeaf(sessionId);
  }

  // --- closing ---------------------------------------------------------

  function closeTab(tabId) {
    if (tabs.length <= 1) return; // always keep at least one tab open
    const index = tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    const [tab] = tabs.splice(index, 1);
    eachLeaf(tab.root, (leaf) => leaf.session.dispose());
    tab.rootEl.remove();

    if (activeTabId === tabId) {
      switchToTab(tabs[Math.max(0, index - 1)].id);
    } else {
      renderTabBar();
    }
  }

  // One pane's daemon connection closed — typing `exit`/`quit`, the daemon
  // dying, whatever. The pane goes away and its split collapses into its
  // sibling; if it was the tab's last pane the tab closes too, and if that
  // was the last tab the app quits, same as a real terminal.
  function handleSessionEnded(sessionId) {
    const tab = tabOfSession(sessionId);
    if (!tab) return;

    const leaf = findLeaf(tab.root, sessionId);
    leaf?.session.dispose();
    tab.root = removeLeaf(tab.root, sessionId);

    if (tab.root) {
      // Focus falls to some surviving pane rather than nothing.
      if (tab.activeLeafId === sessionId) {
        tab.activeLeafId = leavesOf(tab.root)[0]?.id ?? null;
      }
      renderTab(tab);
      renderTabBar();
      if (tab.id === activeTabId) findLeaf(tab.root, tab.activeLeafId)?.session.focus();
      return;
    }

    // Tab is now empty.
    if (tabs.length <= 1) {
      window.runtime.Quit();
      return;
    }
    const index = tabs.findIndex((t) => t.id === tab.id);
    tabs.splice(index, 1);
    tab.rootEl.remove();
    if (activeTabId === tab.id) {
      switchToTab(tabs[Math.max(0, index - 1)].id);
    } else {
      renderTabBar();
    }
  }

  // --- public surface --------------------------------------------------

  // Every pane across every tab — the jobs overlay lists sessions, not
  // tabs, so a split tab contributes one entry per pane.
  function list() {
    const out = [];
    for (const tab of tabs) {
      eachLeaf(tab.root, (leaf) => out.push({ id: leaf.id, cwd: leaf.session.getCwd() }));
    }
    return out;
  }

  return {
    newTab,
    switchTo,
    closeTab,
    list,
    activeId: () => activeTab()?.activeLeafId ?? null,
    setSidebarToggle,
    setOnLayoutChange,
  };
}
