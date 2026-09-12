// Git worktree state for the sidebar. The heavy lifting is in Go (worktree.go);
// this module owns the directory preference and a small cache so the sidebar's
// 2s poll doesn't re-render identical markup — a rebuild mid-interaction would
// drop the create input's focus.
const STORAGE_KEY = "meerkat.worktrees";

// Mirrors defaultWorktreeDir in worktree.go: a sibling of the repo, so
// worktrees never show up as untracked paths inside the working tree.
export const DEFAULT_DIR = "../<repo>-worktrees";

// The setup script runs inside every worktree this app creates, after `git
// worktree add`. A fresh worktree is a bare checkout: no .env, no
// node_modules, no build output. This is where those get copied or made. It
// sees MEERKAT_WORKTREE, MEERKAT_WORKTREE_NAME, MEERKAT_REPO_ROOT and
// MEERKAT_BRANCH, and runs with the user's login-shell environment.
export const EXAMPLE_SETUP_SCRIPT = `# Runs in the new worktree. Examples:
# cp "$MEERKAT_REPO_ROOT/.env" .env
# npm install`;

let settings = { dir: DEFAULT_DIR, setupScript: "" };

export function initWorktrees() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    // A corrupt entry shouldn't take the app down with it.
  }
}

export function getDir() {
  return settings.dir || DEFAULT_DIR;
}

export function setDir(dir) {
  settings.dir = dir.trim() || DEFAULT_DIR;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function resetDir() {
  setDir(DEFAULT_DIR);
}

export function getSetupScript() {
  return settings.setupScript || "";
}

export function setSetupScript(script) {
  settings.setupScript = script;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// Resolves to a RepoStatus (see worktree.go). A cwd outside any repo comes
// back with root: "" — an ordinary state, not an error.
export async function repoStatus(cwd) {
  if (!cwd) return { root: "", name: "", worktreeDir: "", worktrees: [] };
  return window.go.main.App.RepoStatus(cwd, getDir());
}

// Resolves to { path, setupRan, setupOutput, setupError } — see
// WorktreeCreated in worktree.go. Setup trouble arrives as text, not as a
// rejection: the worktree exists by then and should still be opened.
export function createWorktree(cwd, name) {
  return window.go.main.App.CreateWorktree(cwd, name, getDir(), getSetupScript());
}

export function removeWorktree(cwd, path, force) {
  return window.go.main.App.RemoveWorktree(cwd, path, force);
}
