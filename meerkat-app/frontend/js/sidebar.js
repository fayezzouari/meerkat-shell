import * as daemon from "./daemonClient.js";
import * as worktrees from "./worktrees.js";

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function formatMemory(kb) {
  if (kb === null || kb === undefined) return "";
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

function errorText(err) {
  return String(err?.message || err || "unknown error");
}

// Persistent, not modal: it takes horizontal space from the terminals rather
// than covering them, and so has to stay current while open — hence the poll
// in open(). Jobs are daemon-wide, not scoped to the focused pane; worktrees
// are scoped to the repo the focused pane sits in.
export function createSidebar(sessionManager) {
  const root = document.getElementById("sidebar");
  let visible = false;
  let pollTimer = null;

  // Worktree section state. `creating` and `pendingRemove` also suspend the
  // poll's re-render: rebuilding innerHTML underneath a focused input or a
  // half-answered confirmation would throw the interaction away.
  let repo = null;
  let creating = false;
  let busy = false;
  let pendingRemove = null; // path awaiting confirmation
  let worktreeError = "";

  // Last polled data, so a re-render triggered by a worktree interaction can
  // redraw the other sections instead of blanking them until the next tick.
  let lastSessions = [];
  let lastJobs = [];

  function interacting() {
    return creating || busy || pendingRemove !== null;
  }

  function renderSessions(sessions) {
    if (sessions.length === 0) return `<div class="sidebar-empty">no open panes</div>`;
    const activeId = sessionManager.activeId();
    return sessions
      .map((s) => {
        const active = s.id === activeId;
        return `<div class="sidebar-row sidebar-session${active ? " sidebar-session-active" : ""}" data-id="${s.id}">
          <span class="sidebar-marker">${active ? "●" : "○"}</span>
          <span class="sidebar-label">${escapeHtml(s.cwd)}</span>
        </div>`;
      })
      .join("");
  }

  function renderJobs(jobs) {
    if (jobs.length === 0) return `<div class="sidebar-empty">no active jobs</div>`;
    return jobs
      .map((j) => {
        const mem = formatMemory(j.memoryKB);
        return `<div class="sidebar-row sidebar-job">
          <div class="sidebar-job-top">
            <span class="job-id">[${j.id}]</span>
            <span class="job-status">${escapeHtml(j.status)}</span>
            ${mem ? `<span class="job-mem">${mem}</span>` : ""}
          </div>
          <div class="job-cmd">${escapeHtml(j.cmd)}</div>
        </div>`;
      })
      .join("");
  }

  // The worktree the focused pane is actually sitting in — the longest path
  // that prefixes its cwd, since a worktree directory may nest inside the
  // repo root's path string without being part of that checkout.
  function currentWorktreePath(cwd) {
    let best = "";
    for (const w of repo?.worktrees || []) {
      if ((cwd === w.path || cwd.startsWith(w.path + "/")) && w.path.length > best.length) {
        best = w.path;
      }
    }
    return best;
  }

  function renderWorktreeRow(w, activePath) {
    const active = w.path === activePath;
    const label = w.branch || (w.detached ? `${w.head} (detached)` : w.name);
    const flags = [];
    if (w.isMain) flags.push(`<span class="wt-tag">main</span>`);
    if (w.dirty) flags.push(`<span class="wt-tag wt-tag-dirty" title="uncommitted changes">●</span>`);
    if (w.locked) flags.push(`<span class="wt-tag">locked</span>`);
    if (w.missing || w.prunable) flags.push(`<span class="wt-tag wt-tag-stale">stale</span>`);

    if (pendingRemove === w.path) {
      return `<div class="sidebar-row sidebar-worktree sidebar-worktree-confirm">
        <span class="wt-confirm-text">${w.dirty ? "Discard changes and remove?" : "Remove worktree?"}</span>
        <button class="sidebar-icon-btn sidebar-icon-danger" data-act="remove-confirm" data-path="${escapeHtml(w.path)}">Remove</button>
        <button class="sidebar-icon-btn" data-act="remove-cancel">Cancel</button>
      </div>`;
    }

    return `<div class="sidebar-row sidebar-worktree${active ? " sidebar-worktree-active" : ""}"
                 data-act="open" data-path="${escapeHtml(w.path)}" title="${escapeHtml(w.path)}">
      <span class="sidebar-marker">${active ? "●" : "○"}</span>
      <span class="wt-name">${escapeHtml(w.name)}</span>
      ${label === w.name ? "" : `<span class="wt-branch">${escapeHtml(label)}</span>`}
      ${flags.join("")}
      ${
        w.isMain
          ? ""
          : `<button class="sidebar-icon-btn wt-remove" data-act="remove" data-path="${escapeHtml(w.path)}"
                     title="Remove this worktree">×</button>`
      }
    </div>`;
  }

  function renderWorktrees() {
    if (!repo || !repo.root) {
      return `<div class="sidebar-empty">this pane isn't in a git repo</div>`;
    }

    const activePath = currentWorktreePath(sessionManager.activeCwd());
    const rows = (repo.worktrees || []).map((w) => renderWorktreeRow(w, activePath)).join("");

    const createRow = creating
      ? `<div class="sidebar-row sidebar-worktree-create">
           <input class="wt-input" id="wt-new-name" type="text" placeholder="branch name" spellcheck="false"
                  ${busy ? "disabled" : ""} />
         </div>
         <div class="sidebar-hint">${escapeHtml(repo.worktreeDir)}</div>`
      : "";

    const errorRow = worktreeError ? `<div class="sidebar-error">${escapeHtml(worktreeError)}</div>` : "";
    const busyRow = busy ? `<div class="sidebar-hint">working…</div>` : "";

    return rows + createRow + errorRow + busyRow;
  }

  function rerender() {
    render(lastSessions, lastJobs);
  }

  function render(sessions, jobs) {
    lastSessions = sessions;
    lastJobs = jobs;
    const repoName = repo?.name ? ` · ${escapeHtml(repo.name)}` : "";
    root.innerHTML = `
      <div class="sidebar-section">
        <div class="sidebar-heading">Panes</div>
        ${renderSessions(sessions)}
      </div>
      <div class="sidebar-section">
        <div class="sidebar-heading sidebar-heading-row">
          <span>Worktrees${repoName}</span>
          ${repo?.root ? `<button class="sidebar-icon-btn" data-act="new" title="New worktree">+</button>` : ""}
        </div>
        ${renderWorktrees()}
      </div>
      <div class="sidebar-section">
        <div class="sidebar-heading">Jobs</div>
        ${renderJobs(jobs)}
      </div>
    `;
    root.querySelectorAll(".sidebar-session").forEach((row) => {
      row.addEventListener("click", () => sessionManager.switchTo(row.dataset.id));
    });
    wireWorktrees();
  }

  function wireWorktrees() {
    // Delegated: the buttons sit inside clickable rows, so each handler has to
    // stop the row's own open-a-tab click from firing too.
    root.querySelectorAll("[data-act]").forEach((el) => {
      const act = el.dataset.act;
      el.addEventListener("click", (event) => {
        if (act !== "open") event.stopPropagation();
        switch (act) {
          case "open":
            sessionManager.openTabAt(el.dataset.path);
            break;
          case "new":
            worktreeError = "";
            creating = true;
            rerender();
            break;
          case "remove":
            worktreeError = "";
            pendingRemove = el.dataset.path;
            rerender();
            break;
          case "remove-cancel":
            pendingRemove = null;
            rerender();
            break;
          case "remove-confirm":
            doRemove(el.dataset.path);
            break;
        }
      });
    });

    const input = root.querySelector("#wt-new-name");
    if (input && !busy) {
      input.focus();
      input.addEventListener("keydown", (event) => {
        // Stops here rather than reaching xterm.js, which would otherwise
        // treat the keystroke as terminal input for the focused pane.
        event.stopPropagation();
        if (event.key === "Enter") doCreate(input.value);
        if (event.key === "Escape") {
          creating = false;
          worktreeError = "";
          rerender();
        }
      });
    }
  }

  async function doCreate(name) {
    if (!name.trim()) {
      creating = false;
      rerender();
      return;
    }
    busy = true;
    worktreeError = "";
    rerender();

    try {
      const path = await worktrees.createWorktree(sessionManager.activeCwd(), name.trim());
      creating = false;
      busy = false;
      // Opening it is the point of having created it.
      await sessionManager.openTabAt(path);
    } catch (err) {
      busy = false;
      worktreeError = errorText(err);
    }
    refresh({ force: true });
  }

  async function doRemove(path) {
    const target = (repo?.worktrees || []).find((w) => w.path === path);
    busy = true;
    worktreeError = "";
    try {
      // Dirty worktrees need --force; the confirmation said so explicitly.
      await worktrees.removeWorktree(sessionManager.activeCwd(), path, Boolean(target?.dirty || target?.missing));
    } catch (err) {
      worktreeError = errorText(err);
    }
    busy = false;
    pendingRemove = null;
    refresh({ force: true });
  }

  async function refresh({ force = false } = {}) {
    if (!visible) return;
    // A poll tick must not blow away a focused input or a pending confirm.
    if (interacting() && !force) return;

    const cwd = sessionManager.activeCwd();
    const [jobs, sessions, status] = await Promise.all([
      daemon.listJobs().catch(() => []),
      sessionManager.list(),
      worktrees.repoStatus(cwd).catch((err) => {
        worktreeError = errorText(err);
        return null;
      }),
    ]);
    if (status) repo = status;
    // A live view, not a history: "done" jobs just pile up.
    const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "stopped");
    render(sessions, activeJobs);
  }

  function open() {
    visible = true;
    root.classList.remove("hidden");
    refresh();
    // Cleared on close, so a hidden sidebar costs nothing.
    pollTimer = setInterval(refresh, 2000);
  }

  function close() {
    visible = false;
    creating = false;
    pendingRemove = null;
    worktreeError = "";
    root.classList.add("hidden");
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function toggle() {
    if (visible) close();
    else open();
  }

  return { toggle, open, close, refresh, isOpen: () => visible };
}
