import { createSession } from "./session.js";
import { eachLeaf, leavesOf, findLeaf, replaceLeaf, removeLeaf } from "./splitTree.js";

// Each tab holds a binary split tree, so splits can nest:
//   leaf   { type: "leaf", id, session, paneEl }
//   split  { type: "split", dir: "row" | "column", a, b, fraction }
// `fraction` is the share of the main axis child `a` gets. Leaves own a
// persistent paneEl that gets re-appended, never rebuilt — rebuilding would
// destroy a live terminal.
export function createSessionManager({ tabBarEl, panesEl }) {
  const tabs = []; // { id, rootEl, root, activeLeafId }
  let activeTabId = null;
  let nextTabId = 1;
  let onToggleSidebar = () => {};
  let onLayoutChange = () => {};

  function setSidebarToggle(fn) {
    onToggleSidebar = fn;
  }

  function setOnLayoutChange(fn) {
    onLayoutChange = fn;
  }

  function findTab(tabId) {
    return tabs.find((t) => t.id === tabId);
  }

  function activeTab() {
    return findTab(activeTabId);
  }

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

  // Rewrites the two flex values in place rather than re-rendering: a
  // reparent mid-drag would blow away xterm's canvas every mousemove.
  function attachDividerDrag(divider, splitEl, node, tab) {
    divider.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const horizontal = node.dir === "row";
      const rect = splitEl.getBoundingClientRect();
      const total = horizontal ? rect.width : rect.height;
      if (total <= 0) return;

      const onMove = (e) => {
        const pos = horizontal ? e.clientX - rect.left : e.clientY - rect.top;
        // Clamped so a pane can't be dragged down to a degenerate size.
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

  function updateFocusRing(tab) {
    const leaves = leavesOf(tab.root);
    leaves.forEach((leaf) => {
      leaf.paneEl.classList.toggle("pane-focused", leaves.length > 1 && leaf.id === tab.activeLeafId);
    });
  }

  function renderTabBar() {
    // Removes only .tab children, so static markup in the bar survives.
    tabBarEl.querySelectorAll(".tab").forEach((el) => el.remove());
    tabs.forEach((tab) => {
      const tabEl = document.createElement("div");
      tabEl.className = "tab" + (tab.id === activeTabId ? " active" : "");

      const leaf = findLeaf(tab.root, tab.activeLeafId) || leavesOf(tab.root)[0];
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = labelFor(leaf?.session.getCwd() || "");
      tabEl.appendChild(label);

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

  function labelFor(cwd) {
    return cwd.split("/").filter(Boolean).pop() || "/";
  }

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
    // mousedown rather than click, so the focus ring moves on press, before
    // any text-selection drag starts.
    paneEl.addEventListener("mousedown", () => focusLeaf(session.id));
    return leaf;
  }

  // `cwd` opens the tab somewhere specific (the sidebar's worktree rows);
  // without it the new tab inherits the focused pane's directory.
  async function newTab({ cwd } = {}) {
    const inheritCwd = cwd || activeSession()?.getCwd();
    const rootEl = document.createElement("div");
    rootEl.className = "tab-pane-root";
    panesEl.appendChild(rootEl);

    const tab = { id: `tab-${nextTabId++}`, rootEl, root: null, activeLeafId: null };
    tabs.push(tab);

    let leaf;
    try {
      leaf = await spawnLeaf({ initialCwd: inheritCwd });
    } catch (err) {
      // Otherwise the rejection goes nowhere and the window stays blank.
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
    // Deliberately generic: any throw while building a session lands here,
    // so the daemon is only offered as a likely cause, not asserted.
    box.innerHTML = `
      <div class="pane-error-title">Couldn't open this terminal</div>
      <div class="pane-error-detail"></div>
      <div class="pane-error-hint">
        If the daemon isn't running, start it with <code>./launch.sh</code>,
        or from <code>meerkat-daemon/</code> run <code>mix run --no-halt</code>
        — it logs to <code>~/.meerkat/daemon.log</code>.
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

  // "row" puts the new pane to the right, "column" below.
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

    // A display:none xterm.js instance can miscompute layout.
    eachLeaf(tab.root, (leaf) => leaf.session.fit());
    if (focus) findLeaf(tab.root, tab.activeLeafId)?.session.focus();
    renderTabBar();
  }

  // Takes a *session* id — that's what the jobs overlay lists.
  function switchTo(sessionId) {
    focusLeaf(sessionId);
  }

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

  // The pane goes away and its split collapses into its sibling; the last
  // pane closes the tab, and the last tab quits the app.
  function handleSessionEnded(sessionId) {
    const tab = tabOfSession(sessionId);
    if (!tab) return;

    const leaf = findLeaf(tab.root, sessionId);
    leaf?.session.dispose();
    tab.root = removeLeaf(tab.root, sessionId);

    if (tab.root) {
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

  // One entry per pane, across every tab.
  function list() {
    const out = [];
    for (const tab of tabs) {
      eachLeaf(tab.root, (leaf) => out.push({ id: leaf.id, cwd: leaf.session.getCwd() }));
    }
    return out;
  }

  return {
    newTab,
    openTabAt: (cwd) => newTab({ cwd }),
    switchTo,
    closeTab,
    list,
    activeCwd: () => activeSession()?.getCwd() || "",
    activeId: () => activeTab()?.activeLeafId ?? null,
    setSidebarToggle,
    setOnLayoutChange,
  };
}
