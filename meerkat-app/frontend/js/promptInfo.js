// Fetched once — the home directory doesn't change mid-session.
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

// Not cached by cwd: the branch can change without cwd changing, and a local
// `git` call per prompt is cheap.
export async function locationFor(cwd) {
  const [homeDir, git] = await Promise.all([
    getHomeDir(),
    window.go.main.App.GitInfo(cwd).catch(() => ({ repo: "", branch: "" })),
  ]);

  if (git && git.repo) {
    const repo = `\x1b[36m${git.repo}\x1b[0m`;
    const branch = git.branch ? ` \x1b[33m${git.branch}\x1b[0m` : "";
    // Otherwise the prompt looks identical at the repo root and three
    // directories deep.
    const subpath = git.subpath ? ` \x1b[90m${git.subpath}\x1b[0m` : "";
    return repo + branch + subpath;
  }

  return shorten(cwd, homeDir);
}
