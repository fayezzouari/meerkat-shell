// Git worktree state for the sidebar. The heavy lifting is in Go (worktree.go);
// this module owns the directory preference and a small cache so the sidebar's
// 2s poll doesn't re-render identical markup — a rebuild mid-interaction would
// drop the create input's focus.
const STORAGE_KEY = "meerkat.worktrees";

// Mirrors defaultWorktreeDir in worktree.go: a sibling of the repo, so
// worktrees never show up as untracked paths inside the working tree.
export const DEFAULT_DIR = "../<repo>-worktrees";

let settings = { dir: DEFAULT_DIR };

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

// Resolves to a RepoStatus (see worktree.go). A cwd outside any repo comes
// back with root: "" — an ordinary state, not an error.
export async function repoStatus(cwd) {
  if (!cwd) return { root: "", name: "", worktreeDir: "", worktrees: [] };
  return window.go.main.App.RepoStatus(cwd, getDir());
}

// Resolves to the new worktree's absolute path.
export function createWorktree(cwd, name) {
  return window.go.main.App.CreateWorktree(cwd, name, getDir());
}

export function removeWorktree(cwd, path, force) {
  return window.go.main.App.RemoveWorktree(cwd, path, force);
}
