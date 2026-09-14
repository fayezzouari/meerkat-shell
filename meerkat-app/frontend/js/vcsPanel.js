import * as vcs from "./vcs.js";

// Source control, on the right of the terminals. A view onto the checkout the
// focused pane is sitting in: what is staged, what is not, what is new, what
// has been committed and — highlighted — what has not been pushed yet. Plus
// the handful of actions that are tedious to type and easy to get wrong in a
// hurry: stage, unstage, discard, commit, stash, pull, push, sync.
//
// Beta. The terminal beside it is the authority; this panel is a mirror that
// refreshes on a timer and after its own actions, and any state it does not
// understand (an interactive rebase, a submodule, a sparse checkout) it shows
// as best it can rather than pretending to manage.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function errorText(err) {
  return String(err?.message || err || "unknown error");
}

const STORAGE_KEY = "meerkat.vcs";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 240;
const POLL_MS = 3000;
const REMOTE_TIMEOUT_MS = 6000;

// A panel on the right shares the window with the sidebar on the left; both
// have to leave room for a terminal worth having.
function widthBounds() {
  return { min: MIN_WIDTH, max: Math.max(MIN_WIDTH, Math.min(720, window.innerWidth - 360)) };
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      width: Number.isFinite(Number(saved.width)) && saved.width > 0 ? Number(saved.width) : DEFAULT_WIDTH,
      view: saved.view === "tree" ? "tree" : "list",
    };
  } catch {
    return { width: DEFAULT_WIDTH, view: "list" };
  }
}

// git's one-letter codes, spelled out for the row's tooltip.
const STATUS_WORDS = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "unmerged",
  "?": "untracked",
};

// Stroke icons, 16px grid, coloured by currentColor. Inline so a button is one
// element and the panel needs no icon font.
const ICON = {
  plus: `<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>`,
  minus: `<svg viewBox="0 0 16 16"><path d="M3 8h10"/></svg>`,
  undo: `<svg viewBox="0 0 16 16"><path d="M3.5 7.5a5 5 0 1 1 1.4 4.2"/><path d="M3 3.5v4h4"/></svg>`,
  check: `<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`,
  trash: `<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8h5.6l.7-8"/></svg>`,
  pop: `<svg viewBox="0 0 16 16"><path d="M8 11V3.5M4.8 6.7L8 3.5l3.2 3.2"/><path d="M3 11.5v1.5h10v-1.5"/></svg>`,
  down: `<svg viewBox="0 0 16 16"><path d="M8 3v8.5M4.5 8L8 11.5 11.5 8"/><path d="M3 13.5h10"/></svg>`,
  up: `<svg viewBox="0 0 16 16"><path d="M8 13V4.5M4.5 8L8 4.5 11.5 8"/><path d="M3 2.5h10"/></svg>`,
  sync: `<svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 0 1-8.7 3.4M3 8a5 5 0 0 1 8.7-3.4"/><path d="M11 2v3H8M5 14v-3h3"/></svg>`,
  box: `<svg viewBox="0 0 16 16"><path d="M2.5 5.5h11v7.5h-11zM2.5 5.5l1.5-2.5h8l1.5 2.5M6.5 8.5h3"/></svg>`,
  refresh: `<svg viewBox="0 0 16 16"><path d="M13 8A5 5 0 1 1 9.8 3.3"/><path d="M13 2.5v3.5H9.5"/></svg>`,
  chevron: `<svg viewBox="0 0 16 16"><path d="M4 6.5l4 4 4-4"/></svg>`,
  x: `<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
};

function iconBtn(act, icon, title, extra = "", cls = "") {
  return `<button class="vcs-mini vcs-icon${cls ? " " + cls : ""}" data-act="${act}" ${extra} title="${escapeHtml(title)}">${ICON[icon]}</button>`;
}

function relativeTime(unixSeconds) {
  const delta = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (delta < 60) return "now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)}d`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

// Splits "src/js/panel.js" into the dim directory and the file name the eye
// actually looks for.
function splitPath(path) {
  const at = path.lastIndexOf("/");
  return at < 0 ? { dir: "", name: path } : { dir: path.slice(0, at + 1), name: path.slice(at + 1) };
}

// Turns a flat list of files into nested folders for the tree view. Folders
// with a single child folder are collapsed into one row ("src/js/") so a deep
// path does not cost five rows of indentation to reach one file.
function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push(f);
  }
  function compact(node) {
    const out = { dirs: [], files: node.files };
    for (const [name, child] of [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      let label = name;
      let current = child;
      while (current.files.length === 0 && current.dirs.size === 1) {
        const [[only, next]] = current.dirs.entries();
        label += "/" + only;
        current = next;
      }
      out.dirs.push({ name: label, ...compact(current) });
    }
    return out;
  }
  return compact(root);
}

// Renders a unified diff as rows. Header lines (diff --git, index, ---, +++)
// are dropped: the row above already says which file this is.
export function createVcsPanel(sessionManager) {
  const root = document.getElementById("vcs");
  const grip = document.getElementById("vcs-grip");

  let visible = false;
  let pollTimer = null;
  const settings = readSettings();
  let width = applyWidth(settings.width);
  let view = settings.view;

  // What the panel last knew, and its serialized form for change detection:
  // a poll that finds nothing new leaves the DOM alone, which is what keeps a
  // an expanded folder from collapsing under the reader.
  let status = null;
  let statusKey = "";
  let statusCwd = "";
  let loadError = "";

  // Interaction state. Any of these being set holds the poll's re-render off,
  // as the sidebar does, so a click is never answered with a rebuilt DOM.
  let busy = ""; // label of the action in flight
  let pendingDiscard = null; // key of the row awaiting confirmation
  let pendingStashDrop = null;
  let stashing = false;
  let menuOpen = false;
  let commitMessage = "";
  let stashMessage = "";

  // Last action's transcript. Errors stay until the next action; a success
  // fades on the next status change so "Everything up-to-date" is not the
  // panel's headline for the rest of the session.
  let result = null; // { kind: "ok" | "error", text }

  const collapsedSections = new Set();
  const collapsedDirs = new Set();

  function interacting() {
    return Boolean(busy) || pendingDiscard !== null || pendingStashDrop !== null || stashing || menuOpen || textFocused();
  }

  function textFocused() {
    const el = document.activeElement;
    return Boolean(el && root.contains(el) && (el.tagName === "TEXTAREA" || el.tagName === "INPUT"));
  }

  function applyWidth(w) {
    const { min, max } = widthBounds();
    const clamped = Math.round(Math.min(max, Math.max(min, w)));
    document.documentElement.style.setProperty("--vcs-width", `${clamped}px`);
    return clamped;
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ width, view }));
    } catch {
      // A convenience, not state.
    }
  }

  function cwd() {
    return sessionManager.activeCwd();
  }

  // ── rendering ──────────────────────────────────────────────────────

  function fileKey(kind, f) {
    return `${kind}:${f.path}`;
  }

  function renderFileRow(kind, f, depth) {
    const key = fileKey(kind, f);
    const code = kind === "staged" ? f.index : f.worktree;
    const word = STATUS_WORDS[code] || code;
    const { dir, name } = splitPath(f.path);
    const label =
      view === "tree"
        ? `<span class="vcs-file-name">${escapeHtml(name)}</span>`
        : `<span class="vcs-file-dir">${escapeHtml(dir)}</span><span class="vcs-file-name">${escapeHtml(name)}</span>`;
    const from = f.origPath ? `<span class="vcs-file-from" title="renamed from ${escapeHtml(f.origPath)}">← ${escapeHtml(splitPath(f.origPath).name)}</span>` : "";

    if (pendingDiscard === key) {
      const text = kind === "new" ? `Delete ${escapeHtml(name)}? It is not in git.` : `Discard changes to ${escapeHtml(name)}?`;
      return `<div class="vcs-row vcs-confirm" style="--depth:${depth}">
        <span class="vcs-confirm-text">${text}</span>
        <button class="vcs-mini vcs-mini-danger" data-act="discard-confirm" data-key="${escapeHtml(key)}">Discard</button>
        <button class="vcs-mini" data-act="discard-cancel">Cancel</button>
      </div>`;
    }

    return `<div class="vcs-row vcs-file" data-act="open-diff" data-key="${escapeHtml(key)}" data-word="${escapeHtml(word)}"
                 style="--depth:${depth}" title="${escapeHtml(f.path)} — ${word}. Click to open the diff in a tab.">
        <span class="vcs-status vcs-status-${escapeHtml(code === "?" ? "U" : code)}">${escapeHtml(code === "." ? "" : code)}</span>
        <span class="vcs-file-label">${label}${from}</span>
      </div>`;
  }

  function renderFiles(kind, files) {
    if (view !== "tree") return files.map((f) => renderFileRow(kind, f, 0)).join("");
    const tree = buildTree(files);
    const out = [];
    function walk(node, depth, prefix) {
      for (const d of node.dirs) {
        const id = `${kind}:${prefix}${d.name}/`;
        const closed = collapsedDirs.has(id);
        out.push(`<div class="vcs-row vcs-dir" data-act="toggle-dir" data-dir="${escapeHtml(id)}" style="--depth:${depth}">
          <span class="vcs-caret">${closed ? "▸" : "▾"}</span>
          <span class="vcs-dir-name">${escapeHtml(d.name)}/</span>
        </div>`);
        if (!closed) walk(d, depth + 1, `${prefix}${d.name}/`);
      }
      for (const f of node.files) out.push(renderFileRow(kind, f, depth));
    }
    walk(tree, 0, "");
    return out.join("");
  }

  function renderSection(id, title, files, bulk) {
    if (!files || files.length === 0) return "";
    const closed = collapsedSections.has(id);
    return `<div class="vcs-section">
      <div class="vcs-section-head">
        <span class="vcs-section-title" data-act="toggle-section" data-section="${id}">
          <span class="vcs-caret">${closed ? "▸" : "▾"}</span>${title}
          <span class="vcs-count">${files.length}</span>
        </span>
        <span class="vcs-section-actions">${bulk || ""}</span>
      </div>
      ${closed ? "" : renderFiles(id, files)}
    </div>`;
  }

  function renderCommits() {
    const commits = status.commits || [];
    if (commits.length === 0) return `<div class="vcs-empty">no commits yet</div>`;
    return commits
      .map((c) => {
        const local = !c.pushed;
        const hint = local
          ? status.upstream
            ? `not on ${status.upstream} yet`
            : "no upstream — nothing has been pushed"
          : `on ${status.upstream}`;
        return `<div class="vcs-row vcs-commit${local ? " vcs-commit-local" : ""}" title="${escapeHtml(c.hash)}&#10;${escapeHtml(c.author)} · ${escapeHtml(hint)}">
          <span class="vcs-commit-mark">${local ? "●" : "○"}</span>
          <span class="vcs-commit-hash">${escapeHtml(c.short)}</span>
          <span class="vcs-commit-subject">${escapeHtml(c.subject)}</span>
          ${local ? `<span class="vcs-tag vcs-tag-local">local</span>` : ""}
          <span class="vcs-commit-time">${relativeTime(c.time)}</span>
        </div>`;
      })
      .join("");
  }

  function renderStashes() {
    const stashes = status.stashes || [];
    const form = stashing
      ? `<div class="vcs-row vcs-stash-form">
           <input class="vcs-input" id="vcs-stash-msg" type="text" placeholder="stash message (optional)" spellcheck="false" value="${escapeHtml(stashMessage)}" />
           <button class="vcs-mini" data-act="stash-confirm" title="Stash everything, untracked files included">Stash</button>
           <button class="vcs-mini" data-act="stash-cancel">Cancel</button>
         </div>`
      : "";
    if (stashes.length === 0 && !form) return "";
    const rows = stashes
      .map((s) => {
        if (pendingStashDrop === s.ref) {
          return `<div class="vcs-row vcs-confirm">
            <span class="vcs-confirm-text">Drop ${escapeHtml(s.ref)}? This cannot be undone.</span>
            <button class="vcs-mini vcs-mini-danger" data-act="stash-drop-confirm" data-ref="${escapeHtml(s.ref)}">Drop</button>
            <button class="vcs-mini" data-act="stash-drop-cancel">Cancel</button>
          </div>`;
        }
        return `<div class="vcs-row vcs-stash" title="${escapeHtml(s.subject)}">
          <span class="vcs-commit-hash">${escapeHtml(s.ref)}</span>
          <span class="vcs-commit-subject">${escapeHtml(s.subject)}</span>
          <span class="vcs-row-actions">
            ${iconBtn("stash-pop", "pop", "Pop: apply and drop", `data-ref="${escapeHtml(s.ref)}"`)}
            ${iconBtn("stash-drop", "trash", "Drop without applying", `data-ref="${escapeHtml(s.ref)}"`, "vcs-mini-danger")}
          </span>
        </div>`;
      })
      .join("");
    return `<div class="vcs-section">
      <div class="vcs-section-head">
        <span class="vcs-section-title">Stashes <span class="vcs-count">${stashes.length}</span></span>
      </div>
      ${form}${rows}
    </div>`;
  }

  function renderBranch() {
    const s = status;
    const name = s.branch ? escapeHtml(s.branch) : `<span class="vcs-detached">detached at ${escapeHtml(s.head || "?")}</span>`;
    const counts = [];
    if (s.ahead) counts.push(`<span class="vcs-ab vcs-ab-ahead" title="${s.ahead} commit(s) to push">↑${s.ahead}</span>`);
    if (s.behind) counts.push(`<span class="vcs-ab vcs-ab-behind" title="${s.behind} commit(s) to pull">↓${s.behind}</span>`);
    const upstream = s.upstream
      ? `<span class="vcs-upstream" title="upstream">${escapeHtml(s.upstream)}</span>`
      : `<span class="vcs-upstream vcs-upstream-none" title="${s.hasRemote ? "Push sets it" : "Add a remote in the terminal: git remote add origin …"}">no upstream</span>`;
    return `<div class="vcs-branch">
      <span class="vcs-branch-icon">⎇</span>
      <span class="vcs-branch-name">${name}</span>
      ${counts.join("")}
      ${upstream}
    </div>`;
  }

  // One dropdown for the remote operations and stash, rather than a row of
  // buttons competing with the commit box for the panel's width. Each item
  // names the git command it runs; the counts say why you would.
  function renderActions() {
    const s = status;
    const dis = busy ? "disabled" : "";
    const noRemote = !s.hasRemote;
    const remoteHint = noRemote ? "no remote in this repository" : "";
    const item = (act, icon, label, hint, disabled) =>
      `<button class="vcs-menu-item" data-act="${act}" ${disabled ? "disabled" : ""}>
        <span class="vcs-menu-icon">${ICON[icon]}</span>
        <span class="vcs-menu-label">${label}</span>
        <span class="vcs-menu-hint">${escapeHtml(hint)}</span>
      </button>`;
    const menu = menuOpen
      ? `<div class="vcs-menu">
          ${item("pull", "down", `Pull${s.behind ? ` <b>↓${s.behind}</b>` : ""}`, remoteHint || "git pull", noRemote)}
          ${item("push", "up", `Push${s.ahead ? ` <b>↑${s.ahead}</b>` : ""}`, remoteHint || (s.upstream ? "git push" : "git push -u, sets the upstream"), noRemote)}
          ${item("sync", "sync", "Sync", remoteHint || "pull, then push", noRemote)}
          <div class="vcs-menu-sep"></div>
          ${item("stash", "box", "Stash…", hasWorkingChanges() ? "stash push --include-untracked" : "nothing to stash", !hasWorkingChanges())}
          <div class="vcs-menu-sep"></div>
          ${item("refresh", "refresh", "Refresh", "re-read the checkout now", false)}
        </div>`
      : "";
    const summary = [];
    if (s.behind) summary.push(`↓${s.behind}`);
    if (s.ahead) summary.push(`↑${s.ahead}`);
    return `<div class="vcs-actions">
      <span class="vcs-actions-spacer">${busy ? `<span class="vcs-hint">${escapeHtml(busy)}…</span>` : ""}</span>
      <span class="vcs-menu-wrap">
        <button class="vcs-btn vcs-btn-menu${menuOpen ? " vcs-btn-menu-open" : ""}" data-act="menu" ${dis} title="Pull, push, sync, stash">
          ${summary.length ? `<span class="vcs-menu-summary">${summary.join(" ")}</span>` : ""}Actions <span class="vcs-menu-chevron">${ICON.chevron}</span>
        </button>
        ${menu}
      </span>
    </div>`;
  }

  function hasWorkingChanges() {
    return (status.staged?.length || 0) + (status.unstaged?.length || 0) + (status.untracked?.length || 0) > 0;
  }

  function renderCommitBox() {
    const staged = status.staged?.length || 0;
    const canCommit = staged > 0 && commitMessage.trim() && !busy && (status.conflicted?.length || 0) === 0;
    const hint =
      status.conflicted?.length > 0
        ? "resolve conflicts first"
        : staged === 0
          ? "stage something to commit"
          : `${staged} file${staged === 1 ? "" : "s"} staged`;
    return `<div class="vcs-commit-box">
      <textarea class="vcs-textarea" id="vcs-commit-msg" rows="2" placeholder="Commit message" spellcheck="true">${escapeHtml(commitMessage)}</textarea>
      <div class="vcs-commit-foot">
        <span class="vcs-hint">${hint}</span>
        <button class="vcs-btn vcs-btn-primary" data-act="commit" ${canCommit ? "" : "disabled"} title="git commit (⌘⏎ in the message box)">Commit</button>
      </div>
    </div>`;
  }

  function renderOperation() {
    if (!status.operation) return "";
    return `<div class="vcs-banner">
      A <b>${escapeHtml(status.operation)}</b> is in progress. Stage each resolved file with ✓, then finish it in the terminal
      (<code>git ${escapeHtml(status.operation)} --continue</code>).
    </div>`;
  }

  function renderResult() {
    if (!result) return "";
    return `<div class="vcs-result vcs-result-${result.kind}">
      <pre>${escapeHtml(result.text)}</pre>
      ${iconBtn("dismiss", "x", "Dismiss")}
    </div>`;
  }

  function render() {
    const scrollTop = root.scrollTop;
    const beta = `<span class="vcs-beta" title="Version control in Meerkat is in beta. It mirrors the checkout the focused pane is in and refreshes every few seconds; the terminal beside it is always authoritative. Report anything it gets wrong.">beta</span>`;
    const head = `<div class="vcs-head">
      <span class="vcs-title">Source Control</span>${beta}
      <span class="vcs-head-spacer"></span>
      <span class="vcs-view" title="How changed files are listed">
        <button class="vcs-mini${view === "list" ? " vcs-mini-on" : ""}" data-act="view-list" title="Flat list">list</button>
        <button class="vcs-mini${view === "tree" ? " vcs-mini-on" : ""}" data-act="view-tree" title="Folder tree">tree</button>
      </span>
    </div>`;

    if (!status || !status.root) {
      root.innerHTML = `${head}
        <div class="vcs-empty vcs-empty-big">${loadError ? escapeHtml(loadError) : "this pane isn't in a git repo"}</div>
        <div class="vcs-footnote">Beta — Meerkat's source control shows the checkout the focused pane is in. Open a terminal inside a repository to use it.</div>`;
      wire();
      return;
    }

    const stageAllBtn = iconBtn("stage-all", "plus", "Stage all changes and untracked files");
    const unstageAllBtn = iconBtn("unstage-all", "minus", "Unstage everything");
    const legend = status.localCount
      ? `<span class="vcs-legend"><span class="vcs-commit-mark vcs-commit-mark-local">●</span> ${status.localCount} not pushed</span>`
      : status.upstream
        ? `<span class="vcs-legend">all pushed</span>`
        : "";

    root.innerHTML = `${head}
      <div class="vcs-repo" title="${escapeHtml(status.root)}">${escapeHtml(status.name)}</div>
      ${renderBranch()}
      ${renderOperation()}
      ${renderActions()}
      ${renderResult()}
      ${renderCommitBox()}
      ${renderSection("conflict", "Conflicts", status.conflicted, "")}
      ${renderSection("staged", "Staged", status.staged, unstageAllBtn)}
      ${renderSection("work", "Changes", status.unstaged, stageAllBtn)}
      ${renderSection("new", "Untracked", status.untracked, stageAllBtn)}
      ${
        hasWorkingChanges() || status.conflicted?.length
          ? ""
          : `<div class="vcs-empty">working tree clean</div>`
      }
      <div class="vcs-section">
        <div class="vcs-section-head">
          <span class="vcs-section-title">Commits</span>
          ${legend}
        </div>
        ${renderCommits()}
        ${status.statusError ? `<div class="vcs-error">${escapeHtml(status.statusError)}</div>` : ""}
      </div>
      ${renderStashes()}
      <div class="vcs-footnote">Beta. Refreshes every ${POLL_MS / 1000}s; the terminal is authoritative.</div>`;

    root.scrollTop = scrollTop;
    wire();
  }

  // ── wiring ─────────────────────────────────────────────────────────

  function wire() {
    root.querySelectorAll("[data-act]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        handle(el.dataset.act, el);
      });
    });

    const msg = root.querySelector("#vcs-commit-msg");
    if (msg) {
      msg.addEventListener("input", () => {
        commitMessage = msg.value;
        const btn = root.querySelector('[data-act="commit"]');
        if (btn) btn.disabled = !(status.staged?.length && commitMessage.trim() && !busy);
      });
      msg.addEventListener("keydown", (event) => {
        // Never reaches xterm: a keystroke here is a message, not input.
        event.stopPropagation();
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          handle("commit");
        }
      });
    }

    const stashInput = root.querySelector("#vcs-stash-msg");
    if (stashInput) {
      stashInput.focus();
      stashInput.addEventListener("input", () => (stashMessage = stashInput.value));
      stashInput.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") handle("stash-confirm");
        if (event.key === "Escape") handle("stash-cancel");
      });
    }
  }

  async function handle(act, el) {
    const dataset = el?.dataset || {};
    switch (act) {
      case "menu":
        menuOpen = !menuOpen;
        return render();
      case "refresh":
        menuOpen = false;
        result = null;
        return refresh({ force: true });
      case "dismiss":
        result = null;
        return render();
      case "view-list":
      case "view-tree":
        view = act === "view-tree" ? "tree" : "list";
        saveSettings();
        return render();
      case "toggle-section":
        toggleIn(collapsedSections, dataset.section);
        return render();
      case "toggle-dir":
        toggleIn(collapsedDirs, dataset.dir);
        return render();
      case "open-diff": {
        const [kind, ...rest] = dataset.key.split(":");
        return sessionManager.openDiff({ cwd: cwd(), kind, path: rest.join(":"), word: dataset.word });
      }
      case "stage":
        return run("staging", () => vcs.stage(cwd(), [dataset.path]));
      case "unstage":
        return run("unstaging", () => vcs.unstage(cwd(), [dataset.path]));
      case "stage-all":
        return run("staging", () => vcs.stageAll(cwd()));
      case "unstage-all":
        return run("unstaging", () => vcs.unstageAll(cwd()));
      case "discard":
        pendingDiscard = dataset.key;
        return render();
      case "discard-cancel":
        pendingDiscard = null;
        return render();
      case "discard-confirm": {
        const key = dataset.key;
        pendingDiscard = null;
        const [kind, ...rest] = key.split(":");
        const path = rest.join(":");
        return run("discarding", () => vcs.discard(cwd(), [path], kind === "new"));
      }
      case "commit": {
        const message = commitMessage.trim();
        if (!message || !(status.staged?.length)) return;
        return run("committing", async () => {
          const r = await vcs.commit(cwd(), message);
          commitMessage = "";
          return r;
        });
      }
      case "stash":
        menuOpen = false;
        stashing = true;
        return render();
      case "stash-cancel":
        stashing = false;
        stashMessage = "";
        return render();
      case "stash-confirm": {
        const message = stashMessage.trim();
        stashing = false;
        stashMessage = "";
        return run("stashing", () => vcs.stash(cwd(), message));
      }
      case "stash-pop":
        return run("popping stash", () => vcs.stashPop(cwd(), dataset.ref));
      case "stash-drop":
        pendingStashDrop = dataset.ref;
        return render();
      case "stash-drop-cancel":
        pendingStashDrop = null;
        return render();
      case "stash-drop-confirm":
        pendingStashDrop = null;
        return run("dropping stash", () => vcs.stashDrop(cwd(), dataset.ref));
      case "pull":
        menuOpen = false;
        return run("pulling", () => vcs.pull(cwd()));
      case "push":
        menuOpen = false;
        return run("pushing", () => vcs.push(cwd()));
      case "sync":
        menuOpen = false;
        return run("syncing", () => vcs.sync(cwd()));
    }
  }

  function toggleIn(set, key) {
    if (set.has(key)) set.delete(key);
    else set.add(key);
  }

  // Every mutating action goes through here: one at a time, buttons disabled
  // while it runs, git's transcript shown after, and a forced refresh so the
  // panel reflects what just happened rather than waiting for the poll.
  async function run(label, fn) {
    if (busy) return;
    busy = label;
    result = null;
    render();
    try {
      const r = await fn();
      const text = typeof r === "object" && r !== null ? String(r.output || "").trim() : "";
      result = text ? { kind: "ok", text } : null;
    } catch (err) {
      result = { kind: "error", text: errorText(err) };
    }
    busy = "";
    await refresh({ force: true });
  }

  // ── polling ────────────────────────────────────────────────────────

  function within(promise, ms) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
    ]);
  }

  async function refresh({ force = false } = {}) {
    if (!visible) return;
    if (interacting() && !force) return;

    const dir = cwd();
    let next;
    try {
      next = await within(vcs.status(dir), REMOTE_TIMEOUT_MS);
      loadError = "";
    } catch (err) {
      loadError = errorText(err);
      next = null;
    }

    // A pane change is a new repo (or none): the folds belong to the old one.
    if (dir !== statusCwd) {
      collapsedDirs.clear();
      statusCwd = dir;
    }

    const key = JSON.stringify(next) + loadError;
    const changed = key !== statusKey;
    statusKey = key;
    if (next) status = next;
    else if (loadError) status = null;

    if (changed && result?.kind === "ok" && !force) result = null;
    if (changed || force) {
      render();
      // Open diff tabs may have changed with the status; refetch them quietly.
      if (changed) sessionManager.refreshDiffs();
    }
  }

  // ── resizing (mirrors the sidebar) ─────────────────────────────────

  function startResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (e) => {
      // The grip sits on the panel's left edge, so dragging left grows it.
      width = applyWidth(startWidth - (e.clientX - startX));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("dragging-divider");
      grip.classList.remove("is-dragging");
      saveSettings();
    };
    document.body.classList.add("dragging-divider");
    grip.classList.add("is-dragging");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (grip) {
    grip.addEventListener("mousedown", startResize);
    grip.addEventListener("dblclick", () => {
      width = applyWidth(DEFAULT_WIDTH);
      saveSettings();
    });
  }
  window.addEventListener("resize", () => {
    width = applyWidth(width);
  });

  // The dropdown closes the way menus do: a click anywhere else, or Escape.
  document.addEventListener("mousedown", (event) => {
    if (menuOpen && !event.target.closest(".vcs-menu-wrap")) {
      menuOpen = false;
      render();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (menuOpen && event.key === "Escape") {
      menuOpen = false;
      render();
    }
  });

  // ── visibility ─────────────────────────────────────────────────────

  function open() {
    visible = true;
    root.classList.remove("hidden");
    grip?.classList.remove("hidden");
    statusKey = "";
    refresh({ force: true });
    pollTimer = setInterval(refresh, POLL_MS);
  }

  function close() {
    visible = false;
    menuOpen = false;
    pendingDiscard = null;
    pendingStashDrop = null;
    stashing = false;
    result = null;
    root.classList.add("hidden");
    grip?.classList.add("hidden");
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function toggle() {
    if (visible) close();
    else open();
  }

  return { toggle, open, close, refresh, isOpen: () => visible };
}
