import * as vcs from "./vcs.js";
import * as keymap from "./keymap.js";
import { stepFontSize, resetFontSize } from "./appearance.js";

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function errorText(err) {
  return String(err?.message || err || "unknown error");
}

// A unified diff as rows, file headers stripped: the caller already says
// which file this is.
export function renderDiff(text) {
  if (text === null) return `<div class="vcs-diff-empty">loading…</div>`;
  if (!text) return `<div class="vcs-diff-empty">no textual changes (binary, mode, or identical)</div>`;
  const rows = [];
  for (const line of text.split("\n")) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode")
    ) {
      continue;
    }
    if (line === "") continue;
    let cls = "vcs-diff-ctx";
    if (line.startsWith("@@")) cls = "vcs-diff-hunk";
    else if (line.startsWith("+")) cls = "vcs-diff-add";
    else if (line.startsWith("-")) cls = "vcs-diff-del";
    else if (line.startsWith("\\")) cls = "vcs-diff-meta";
    rows.push(`<div class="vcs-diff-line ${cls}">${escapeHtml(line)}</div>`);
  }
  return `<div class="vcs-diff">${rows.join("")}</div>`;
}

// One tab per (repo, row): the source control panel asks for the same key
// again to bring an already-open diff to the front rather than open a twin.
export function diffKey({ cwd, kind, path }) {
  return `${cwd}|${kind}:${path}`;
}

let nextId = 1;

// A pane that shows one file's diff instead of a terminal. Quacks like a
// session — id, getCwd, fit, focus, dispose — so the session manager can hold
// it in a leaf without knowing the difference. `kind` is "staged", "work" or
// "new", as the source control panel keys its rows.
export function createDiffView({
  container,
  cwd,
  path,
  kind,
  word,
  onNewTabRequested,
  onToggleSidebarRequested,
  onToggleVcsRequested,
  onCloseRequested,
}) {
  const id = `diff-${nextId++}`;
  const name = path.split("/").filter(Boolean).pop() || path;
  let text = null;
  let disposed = false;

  container.classList.add("pane-diff");
  container.tabIndex = 0;
  container.innerHTML = `
    <div class="diff-head">
      <span class="diff-head-kind">${escapeHtml(kind === "staged" ? "staged" : word || "")}</span>
      <span class="diff-head-path" title="${escapeHtml(path)}">${escapeHtml(path)}</span>
      <button class="diff-head-close" title="Close (Esc)">×</button>
    </div>
    <div class="diff-body vcs-diff-wrap"></div>
  `;
  const body = container.querySelector(".diff-body");
  container.querySelector(".diff-head-close").addEventListener("click", () => onCloseRequested(id));

  // Only the shortcuts that make sense with no terminal under the keys.
  container.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseRequested(id);
    } else if (keymap.matches(event, "newTab")) {
      event.preventDefault();
      onNewTabRequested();
    } else if (keymap.matches(event, "toggleSidebar")) {
      event.preventDefault();
      onToggleSidebarRequested();
    } else if (keymap.matches(event, "toggleVcs")) {
      event.preventDefault();
      onToggleVcsRequested();
    } else if (keymap.matches(event, "zoomIn")) {
      event.preventDefault();
      stepFontSize(1);
    } else if (keymap.matches(event, "zoomOut")) {
      event.preventDefault();
      stepFontSize(-1);
    } else if (keymap.matches(event, "zoomReset")) {
      event.preventDefault();
      resetFontSize();
    }
  });

  function paint() {
    if (disposed) return;
    body.innerHTML = renderDiff(text);
  }

  // Keeps the scroll position: a refresh after a status poll must not throw
  // the reader back to the top.
  async function refresh() {
    try {
      const next = await vcs.diff(cwd, path, kind === "staged", kind === "new");
      text = next || "";
    } catch (err) {
      text = `error: ${errorText(err)}`;
    }
    const top = body.scrollTop;
    paint();
    body.scrollTop = top;
  }

  paint();
  refresh();

  return {
    id,
    kind: "diff",
    key: diffKey({ cwd, kind, path }),
    title: () => name,
    getCwd: () => cwd,
    fit: () => {},
    focus: () => container.focus({ preventScroll: true }),
    refresh,
    dispose: () => {
      disposed = true;
      container.innerHTML = "";
    },
  };
}
