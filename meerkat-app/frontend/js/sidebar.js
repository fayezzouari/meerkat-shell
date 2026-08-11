import * as daemon from "./daemonClient.js";

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// memoryKB is the RSS of the job's whole process tree (see app.go's
// processTreeRSSKB), not just its top-level process — a `cmd1 | cmd2`
// background job's real footprint is the sum of every stage.
function formatMemory(kb) {
  if (kb === null || kb === undefined) return "";
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

// The Cmd+B sidebar: open panes and running jobs, shown beside the
// terminal rather than floating over it.
//
// Being persistent rather than modal changes two things versus the old
// overlay. It takes horizontal space from the terminals instead of
// covering them (see index.html's #workspace flex row — the panes shrink,
// and session.js's ResizeObserver refits them), and its contents have to
// stay current while it sits open, hence the poll below. Jobs come from
// ListJobs() (app.go), which reflects meerkat-daemon's single shared
// JobManager — the same jobs regardless of which pane is focused, so this
// isn't scoped to one session; it's every job from every pane (and the
// CLI, if one's connected).
export function createSidebar(sessionManager) {
  const root = document.getElementById("sidebar");
  let visible = false;
  let pollTimer = null;

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

  function render(sessions, jobs) {
    root.innerHTML = `
      <div class="sidebar-section">
        <div class="sidebar-heading">Panes</div>
        ${renderSessions(sessions)}
      </div>
      <div class="sidebar-section">
        <div class="sidebar-heading">Jobs</div>
        ${renderJobs(jobs)}
      </div>
    `;
    root.querySelectorAll(".sidebar-session").forEach((row) => {
      // Focuses that pane (switching tabs if it lives in another one).
      // The sidebar stays open — that's the point of it not being modal.
      row.addEventListener("click", () => sessionManager.switchTo(row.dataset.id));
    });
  }

  async function refresh() {
    if (!visible) return;
    const [jobs, sessions] = await Promise.all([daemon.listJobs().catch(() => []), sessionManager.list()]);
    // "done" jobs pile up over a session and aren't actionable — this is
    // meant to be a live view of what's actually going on, not a history.
    const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "stopped");
    render(sessions, activeJobs);
  }

  function open() {
    visible = true;
    root.classList.remove("hidden");
    refresh();
    // Jobs start, finish, and change memory footprint while the sidebar
    // sits open; without polling it would silently go stale the moment it
    // was shown. Cleared on close so a hidden sidebar costs nothing.
    pollTimer = setInterval(refresh, 2000);
  }

  function close() {
    visible = false;
    root.classList.add("hidden");
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function toggle() {
    if (visible) close();
    else open();
  }

  // Lets the rest of the app push an immediate update (e.g. a pane was
  // split or closed) instead of waiting out the poll interval.
  return { toggle, open, close, refresh, isOpen: () => visible };
}
