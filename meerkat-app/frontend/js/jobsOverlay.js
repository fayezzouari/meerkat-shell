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

// Ctrl+M overlay: open tabs + background jobs. Plain DOM/CSS rather than
// drawn through xterm.js — far simpler for a panel like this. Jobs come
// from ListJobs() (app.go), which reflects meerkat-daemon's single shared
// JobManager — the same jobs regardless of which tab is active, so this
// isn't scoped to "the current session's jobs," it's every job from every
// tab (and the CLI, if one's connected).
export function createJobsOverlay(sessionManager) {
  const root = document.createElement("div");
  root.id = "overlay";
  root.classList.add("hidden");
  document.body.appendChild(root);

  // Click on the backdrop (outside the panel) closes it.
  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });

  function renderSessions(sessions) {
    if (sessions.length === 0) return `<div class="overlay-empty">no open tabs</div>`;
    return sessions
      .map((s) => {
        const marker = s.id === sessionManager.activeId() ? "●" : "○";
        return `<div class="overlay-row overlay-session" data-id="${s.id}">${marker} ${escapeHtml(s.cwd)}</div>`;
      })
      .join("");
  }

  function renderJobs(jobs) {
    if (jobs.length === 0) return `<div class="overlay-empty">no jobs</div>`;
    return jobs
      .map((j) => {
        const exit = j.exitCode === null || j.exitCode === undefined ? "" : ` (exit ${j.exitCode})`;
        const mem = formatMemory(j.memoryKB);
        return `<div class="overlay-row overlay-job">
          <span class="job-id">[${j.id}]</span>
          <span class="job-status">${escapeHtml(j.status)}${exit}</span>
          ${mem ? `<span class="job-mem">${mem}</span>` : ""}
          <span class="job-cmd">${escapeHtml(j.cmd)}</span>
        </div>`;
      })
      .join("");
  }

  function render(sessions, jobs) {
    root.innerHTML = `
      <div class="overlay-panel">
        <div class="overlay-section">
          <div class="overlay-heading">Sessions</div>
          ${renderSessions(sessions)}
        </div>
        <div class="overlay-section">
          <div class="overlay-heading">Jobs</div>
          ${renderJobs(jobs)}
        </div>
      </div>
    `;
    root.querySelectorAll(".overlay-session").forEach((row) => {
      row.addEventListener("click", () => {
        sessionManager.switchTo(row.dataset.id);
        close();
      });
    });
  }

  let visible = false;

  async function open() {
    visible = true;
    root.classList.remove("hidden");
    const [jobs, sessions] = await Promise.all([daemon.listJobs().catch(() => []), sessionManager.list()]);
    render(sessions, jobs);
  }

  function close() {
    visible = false;
    root.classList.add("hidden");
  }

  function toggle() {
    if (visible) close();
    else open();
  }

  return { toggle };
}
