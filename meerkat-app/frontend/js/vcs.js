// The bridge to vcs.go. Thin on purpose: every call takes the focused pane's
// cwd and acts on the checkout that pane is sitting in, so a linked worktree
// gets its own index and its own history rather than the main one's.

const app = () => window.go.main.App;

// Resolves to a VcsStatus (see vcs.go). Outside a repo root is "" — an
// ordinary state for a terminal pane, not an error.
export function status(cwd) {
  if (!cwd) return Promise.resolve({ root: "" });
  return app().VcsStatus(cwd);
}

export function diff(cwd, path, staged, untracked) {
  return app().VcsDiff(cwd, path, staged, untracked);
}

export function stage(cwd, paths) {
  return app().VcsStage(cwd, paths);
}

export function stageAll(cwd) {
  return app().VcsStageAll(cwd);
}

export function unstage(cwd, paths) {
  return app().VcsUnstage(cwd, paths);
}

export function unstageAll(cwd) {
  return app().VcsUnstageAll(cwd);
}

export function discard(cwd, paths, untracked) {
  return app().VcsDiscard(cwd, paths, untracked);
}

// The remaining calls resolve to { output } — git's own transcript, which the
// panel shows as the result.
export function commit(cwd, message) {
  return app().VcsCommit(cwd, message);
}

export function stash(cwd, message) {
  return app().VcsStash(cwd, message);
}

export function stashPop(cwd, ref) {
  return app().VcsStashPop(cwd, ref);
}

export function stashDrop(cwd, ref) {
  return app().VcsStashDrop(cwd, ref);
}

export function pull(cwd) {
  return app().VcsPull(cwd);
}

export function push(cwd) {
  return app().VcsPush(cwd);
}

export function sync(cwd) {
  return app().VcsSync(cwd);
}
