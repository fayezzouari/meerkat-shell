// Resolves what the prompt should show for the current directory: the
// repo name + branch (colored) when cwd is inside a git working tree,
// otherwise the cwd with the home directory shortened to "~" the way a
// real shell prompt does. Backed by HomeDir/GitInfo on the Go side (see
// meerkat-app/prompt.go) — those shell out to the local filesystem/git,
// the same "GUI process talks to the local machine directly" pattern
// complete.go already uses for tab completion.

// Fetched once and cached — the home directory doesn't change mid-session.
let homeDirPromise = null;

function getHomeDir() {
  if (!homeDirPromise) {
    homeDirPromise = window.go.main.App.HomeDir().catch(() => "");
  }
  return homeDirPromise;
}

function shorten(cwd, homeDir) {
  if (homeDir && cwd === homeDir) return "~";
  if (homeDir && cwd.startsWith(homeDir + "/")) return "~" + cwd.slice(homeDir.length);
  return cwd;
}

// Not cached by cwd: the branch can change (checkout/commit) without cwd
// changing, so this is re-fetched on every prompt render — a local `git`
// call is cheap enough that the extra latency isn't noticeable.
export async function locationFor(cwd) {
  const [homeDir, git] = await Promise.all([
    getHomeDir(),
    window.go.main.App.GitInfo(cwd).catch(() => ({ repo: "", branch: "" })),
  ]);

  if (git && git.repo) {
    const repo = `\x1b[36m${git.repo}\x1b[0m`;
    const branch = git.branch ? ` \x1b[33m${git.branch}\x1b[0m` : "";
    // Without this, "repo branch" looks identical whether you're at the
    // repo root or three subdirectories deep — cd-ing into the same
    // subdirectory twice (the second landing on "no such directory")
    // gave no visual sign the first one had actually worked.
    const subpath = git.subpath ? ` \x1b[90m${git.subpath}\x1b[0m` : "";
    return repo + branch + subpath;
  }

  return shorten(cwd, homeDir);
}
