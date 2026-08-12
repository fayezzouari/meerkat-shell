import * as daemon from "./daemonClient.js";

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function formatMemory(kb) {
  if (kb === null || kb === undefined) return "";
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

// Persistent, not modal: it takes horizontal space from the terminals rather
// than covering them, and so has to stay current while open — hence the poll
// in open(). Jobs are daemon-wide, not scoped to the focused pane.
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
      row.addEventListener("click", () => sessionManager.switchTo(row.dataset.id));
    });
  }

  async function refresh() {
    if (!visible) return;
    const [jobs, sessions] = await Promise.all([daemon.listJobs().catch(() => []), sessionManager.list()]);
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
