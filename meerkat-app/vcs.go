package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Source control for the panel on the right of the terminals. Like
// worktree.go, everything here is the real `git` binary: the panel is a view
// onto a checkout the user also drives from the terminal beside it, and the
// only bookkeeping worth trusting for that is git's own.
//
// Every mutating call takes the cwd of the focused pane and acts on the
// worktree that pane is sitting in — a linked worktree is its own checkout with
// its own index, and staging in the main one would be a surprise.

// vcsCommitLimit caps the history the panel shows. It is a recent-activity
// list with the unpushed commits at the top, not a log viewer.
const vcsCommitLimit = 40

// VcsFile is one changed path. Index and Worktree are git's one-letter status
// codes for the two trees (M/A/D/R/C/T, or "." for unchanged), so a file with
// both a staged and an unstaged edit appears twice in the panel: once under
// Staged carrying Index, once under Changes carrying Worktree.
type VcsFile struct {
	Path       string `json:"path"`
	OrigPath   string `json:"origPath"` // renames and copies: where it came from
	Index      string `json:"index"`
	Worktree   string `json:"worktree"`
	Untracked  bool   `json:"untracked"`
	Conflicted bool   `json:"conflicted"`
}

// VcsCommit is one line of history. Pushed is what the panel highlights on:
// false for commits the upstream does not have yet, which is the answer to
// "what have I not shared" the terminal's `git log` makes you work out.
type VcsCommit struct {
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Subject string `json:"subject"`
	Author  string `json:"author"`
	Time    int64  `json:"time"` // unix seconds
	Pushed  bool   `json:"pushed"`
}

type VcsStash struct {
	Ref     string `json:"ref"` // stash@{0}
	Subject string `json:"subject"`
}

// VcsStatus is the whole payload the panel renders from. A cwd outside any
// repo yields a zero value with a nil error — the same convention as
// RepoStatus: not being in a repo is an ordinary state for a terminal pane.
type VcsStatus struct {
	Root        string      `json:"root"` // this worktree's root, "" if not a repo
	Name        string      `json:"name"`
	Branch      string      `json:"branch"`   // "" when detached
	Head        string      `json:"head"`     // abbreviated HEAD, "" on an unborn branch
	Upstream    string      `json:"upstream"` // "origin/main", "" when none is set
	Ahead       int         `json:"ahead"`
	Behind      int         `json:"behind"`
	HasRemote   bool        `json:"hasRemote"` // any remote at all, so push can be offered
	Staged      []VcsFile   `json:"staged"`
	Unstaged    []VcsFile   `json:"unstaged"`
	Untracked   []VcsFile   `json:"untracked"`
	Conflicted  []VcsFile   `json:"conflicted"`
	Commits     []VcsCommit `json:"commits"`
	Stashes     []VcsStash  `json:"stashes"`
	Operation   string      `json:"operation"` // "merge", "rebase", "cherry-pick", "revert", or ""
	LocalCount  int         `json:"localCount"`
	StatusError string      `json:"statusError"` // a partial answer's reason, when one section failed
}

// VcsResult is what a mutating call hands back: git's own words. Pull and push
// print what they did to stderr, and that text is the panel's only feedback.
type VcsResult struct {
	Output string `json:"output"`
}

// worktreeRoot is the root of the checkout cwd is inside — the linked
// worktree's own root, not the main one's.
func worktreeRoot(cwd string) (string, error) {
	if cwd == "" {
		return "", nil
	}
	if info, err := os.Stat(cwd); err != nil || !info.IsDir() {
		return "", nil
	}
	out, err := gitQuery(cwd, "rev-parse", "--show-toplevel")
	if err != nil {
		// Overwhelmingly "not a git repository"; a bare repo also lands here,
		// and there is nothing for the panel to show in one either.
		return "", nil
	}
	return strings.TrimSpace(out), nil
}

func requireRoot(cwd string) (string, error) {
	root, err := worktreeRoot(cwd)
	if err != nil {
		return "", err
	}
	if root == "" {
		return "", fmt.Errorf("%s is not inside a git repository", cwd)
	}
	return root, nil
}

// VcsStatus reports the state of the checkout containing cwd.
func (a *App) VcsStatus(cwd string) (VcsStatus, error) {
	root, err := worktreeRoot(cwd)
	if err != nil || root == "" {
		return VcsStatus{}, err
	}

	// One call carries the branch header and every changed path. -z so a path
	// with a space or a newline in it survives, and porcelain v2 because v1
	// has no branch/upstream/ahead-behind header and mangles renames.
	out, err := gitQuery(root, "status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z")
	if err != nil {
		return VcsStatus{}, err
	}
	st := parseStatusV2(out)
	st.Root = root
	st.Name = filepath.Base(root)
	st.Operation = detectOperation(root)

	if remotes, err := gitQuery(root, "remote"); err == nil {
		st.HasRemote = strings.TrimSpace(remotes) != ""
	}

	// History is optional: an unborn branch has none, and a failure here is
	// not a reason to hide the working tree.
	if st.Head != "" {
		commits, err := recentCommits(root, st.Upstream)
		if err != nil {
			st.StatusError = err.Error()
		}
		st.Commits = commits
		for _, c := range commits {
			if !c.Pushed {
				st.LocalCount++
			}
		}
	}

	if out, err := gitQuery(root, "stash", "list", "--format=%gd%x1f%s"); err == nil {
		st.Stashes = parseStashList(out)
	}

	return st, nil
}

// parseStatusV2 reads `git status --porcelain=v2 --branch -z`. Records are
// NUL-terminated; a rename record ("2 ...") is followed by one more NUL-terminated
// field holding the original path.
func parseStatusV2(out string) VcsStatus {
	var st VcsStatus
	fields := strings.Split(out, "\x00")

	for i := 0; i < len(fields); i++ {
		line := fields[i]
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "# branch.oid "):
			oid := strings.TrimPrefix(line, "# branch.oid ")
			if oid != "(initial)" && len(oid) >= 8 {
				st.Head = oid[:8]
			}
		case strings.HasPrefix(line, "# branch.head "):
			head := strings.TrimPrefix(line, "# branch.head ")
			if head != "(detached)" {
				st.Branch = head
			}
		case strings.HasPrefix(line, "# branch.upstream "):
			st.Upstream = strings.TrimPrefix(line, "# branch.upstream ")
		case strings.HasPrefix(line, "# branch.ab "):
			// "+A -B"
			parts := strings.Fields(strings.TrimPrefix(line, "# branch.ab "))
			if len(parts) == 2 {
				st.Ahead, _ = strconv.Atoi(strings.TrimPrefix(parts[0], "+"))
				st.Behind, _ = strconv.Atoi(strings.TrimPrefix(parts[1], "-"))
			}
		case strings.HasPrefix(line, "# "):
			// Other headers (stash count on newer gits) — not needed.
		case strings.HasPrefix(line, "1 "):
			// 1 XY sub mH mI mW hH hI path
			parts := strings.SplitN(line, " ", 9)
			if len(parts) == 9 {
				addChanged(&st, parts[1], parts[8], "")
			}
		case strings.HasPrefix(line, "2 "):
			// 2 XY sub mH mI mW hH hI Xscore path  NUL  origPath
			parts := strings.SplitN(line, " ", 10)
			if len(parts) == 10 {
				orig := ""
				if i+1 < len(fields) {
					orig = fields[i+1]
					i++
				}
				addChanged(&st, parts[1], parts[9], orig)
			}
		case strings.HasPrefix(line, "u "):
			// u XY sub m1 m2 m3 mW h1 h2 h3 path
			parts := strings.SplitN(line, " ", 11)
			if len(parts) == 11 {
				st.Conflicted = append(st.Conflicted, VcsFile{
					Path: parts[10], Index: parts[1][:1], Worktree: parts[1][1:], Conflicted: true,
				})
			}
		case strings.HasPrefix(line, "? "):
			st.Untracked = append(st.Untracked, VcsFile{Path: line[2:], Untracked: true, Worktree: "?"})
		case strings.HasPrefix(line, "! "):
			// Ignored — only listed with --ignored, which is not asked for.
		}
	}

	for _, list := range []*[]VcsFile{&st.Staged, &st.Unstaged, &st.Untracked, &st.Conflicted} {
		sort.SliceStable(*list, func(a, b int) bool { return (*list)[a].Path < (*list)[b].Path })
	}
	return st
}

// addChanged files one status record under Staged and/or Unstaged. XY is the
// two-tree code: X for the index against HEAD, Y for the worktree against the
// index; "." means no change on that side.
func addChanged(st *VcsStatus, xy string, path string, orig string) {
	if len(xy) != 2 {
		return
	}
	x, y := xy[:1], xy[1:]
	if x != "." {
		st.Staged = append(st.Staged, VcsFile{Path: path, OrigPath: orig, Index: x, Worktree: "."})
	}
	if y != "." {
		// A rename only ever lives in the index; the worktree side of the same
		// record is a plain edit to the new path.
		st.Unstaged = append(st.Unstaged, VcsFile{Path: path, Index: ".", Worktree: y})
	}
}

// detectOperation names an in-progress merge, rebase, cherry-pick or revert
// from the marker files git leaves in the git dir, so the panel can say why
// there are conflicts and what finishing looks like.
func detectOperation(root string) string {
	gitDir, err := gitQuery(root, "rev-parse", "--git-dir")
	if err != nil {
		return ""
	}
	gitDir = strings.TrimSpace(gitDir)
	if !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(root, gitDir)
	}
	exists := func(name string) bool {
		_, err := os.Stat(filepath.Join(gitDir, name))
		return err == nil
	}
	switch {
	case exists("rebase-merge"), exists("rebase-apply"):
		return "rebase"
	case exists("MERGE_HEAD"):
		return "merge"
	case exists("CHERRY_PICK_HEAD"):
		return "cherry-pick"
	case exists("REVERT_HEAD"):
		return "revert"
	}
	return ""
}

// recentCommits lists the last vcsCommitLimit commits on HEAD and marks which
// the upstream already has. Without an upstream every commit is local: there
// is nowhere they could have been pushed to.
func recentCommits(root string, upstream string) ([]VcsCommit, error) {
	out, err := gitQuery(root, "log", "-n", strconv.Itoa(vcsCommitLimit),
		"--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct%x1e")
	if err != nil {
		return nil, err
	}

	unpushed := map[string]bool{}
	if upstream != "" {
		// Everything reachable from HEAD but not from the upstream. Bounded by
		// the same limit: past it nothing is shown, so nothing needs marking.
		if rl, err := gitQuery(root, "rev-list", "-n", strconv.Itoa(vcsCommitLimit), upstream+"..HEAD"); err == nil {
			for _, h := range strings.Fields(rl) {
				unpushed[h] = true
			}
		}
	}

	return parseLog(out, upstream != "", unpushed), nil
}

// parseLog reads the %x1e-separated records recentCommits asks for.
func parseLog(out string, hasUpstream bool, unpushed map[string]bool) []VcsCommit {
	var commits []VcsCommit
	for _, rec := range strings.Split(out, "\x1e") {
		rec = strings.TrimSpace(rec)
		if rec == "" {
			continue
		}
		f := strings.Split(rec, "\x1f")
		if len(f) != 5 {
			continue
		}
		t, _ := strconv.ParseInt(f[4], 10, 64)
		commits = append(commits, VcsCommit{
			Hash:    f[0],
			Short:   f[1],
			Subject: f[2],
			Author:  f[3],
			Time:    t,
			Pushed:  hasUpstream && !unpushed[f[0]],
		})
	}
	return commits
}

func parseStashList(out string) []VcsStash {
	var stashes []VcsStash
	for _, line := range strings.Split(out, "\n") {
		ref, subject, ok := strings.Cut(line, "\x1f")
		if !ok || ref == "" {
			continue
		}
		stashes = append(stashes, VcsStash{Ref: ref, Subject: subject})
	}
	return stashes
}

// ── the diff of one file ────────────────────────────────────────────

// VcsDiff returns the unified diff for one path. staged selects index-vs-HEAD;
// otherwise worktree-vs-index. An untracked file has no index side, so it is
// diffed against nothing, which renders as all additions.
func (a *App) VcsDiff(cwd string, path string, staged bool, untracked bool) (string, error) {
	root, err := requireRoot(cwd)
	if err != nil {
		return "", err
	}
	if err := checkPath(path); err != nil {
		return "", err
	}

	var out string
	switch {
	case untracked:
		out, err = gitDiffNoIndex(root, path)
	case staged:
		out, err = gitQuery(root, "diff", "--cached", "--", path)
	default:
		out, err = gitQuery(root, "diff", "--", path)
	}
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(out) == "" {
		return "", nil
	}
	return out, nil
}

// ── staging ─────────────────────────────────────────────────────────

// checkPath keeps a path from being read as an option by git. Paths come from
// the panel, which got them from git, but a stale row and a fast click are all
// it takes to send something odd.
func checkPath(path string) error {
	if path == "" {
		return fmt.Errorf("no path given")
	}
	if strings.HasPrefix(path, "-") {
		return fmt.Errorf("refusing a path that starts with '-': %s", path)
	}
	if filepath.IsAbs(path) {
		return fmt.Errorf("paths must be relative to the repository: %s", path)
	}
	return nil
}

func checkPaths(paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("no paths given")
	}
	for _, p := range paths {
		if err := checkPath(p); err != nil {
			return err
		}
	}
	return nil
}

// VcsStage adds paths to the index. A deleted path is staged as a deletion,
// which is what `add -A` does and `add` alone refuses.
func (a *App) VcsStage(cwd string, paths []string) error {
	root, err := requireRoot(cwd)
	if err != nil {
		return err
	}
	if err := checkPaths(paths); err != nil {
		return err
	}
	_, err = git(root, append([]string{"add", "-A", "--"}, paths...)...)
	return err
}

// VcsStageAll stages every change, untracked files included.
func (a *App) VcsStageAll(cwd string) error {
	root, err := requireRoot(cwd)
	if err != nil {
		return err
	}
	_, err = git(root, "add", "-A")
	return err
}

// VcsUnstage takes paths out of the index, leaving the worktree alone. On an
// unborn branch there is no HEAD to reset to, so the entries are dropped
// instead; the files stay put as untracked.
func (a *App) VcsUnstage(cwd string, paths []string) error {
	root, err := requireRoot(cwd)
	if err != nil {
		return err
	}
	if err := checkPaths(paths); err != nil {
		return err
	}
	if hasHead(root) {
		_, err = git(root, append([]string{"restore", "--staged", "--"}, paths...)...)
	} else {
		_, err = git(root, append([]string{"rm", "-r", "-q", "--cached", "--"}, paths...)...)
	}
	return err
}

func (a *App) VcsUnstageAll(cwd string) error {
	root, err := requireRoot(cwd)
	if err != nil {
		return err
	}
	if hasHead(root) {
		_, err = git(root, "reset", "-q")
	} else {
		_, err = git(root, "rm", "-r", "-q", "--cached", ".")
	}
	return err
}

func hasHead(root string) bool {
	_, err := gitQuery(root, "rev-parse", "--verify", "--quiet", "HEAD")
	return err == nil
}

// VcsDiscard throws away worktree changes to paths: tracked files go back to
// what the index has, untracked ones are deleted. Staged changes are not
// touched — the panel offers discard only on the Changes and Untracked rows,
// and unstaging first is how a staged change gets discarded.
func (a *App) VcsDiscard(cwd string, paths []string, untracked bool) error {
	root, err := requireRoot(cwd)
	if err != nil {
		return err
	}
	if err := checkPaths(paths); err != nil {
		return err
	}
	if untracked {
		// -d for a directory that is entirely new; never -x, so ignored files
		// (a .env, a node_modules) are not what a mis-click removes.
		_, err = git(root, append([]string{"clean", "-f", "-d", "-q", "--"}, paths...)...)
		return err
	}
	_, err = git(root, append([]string{"restore", "--worktree", "--"}, paths...)...)
	return err
}

// ── commit, stash, remote ────────────────────────────────────────────

func (a *App) VcsCommit(cwd string, message string) (VcsResult, error) {
	root, err := requireRoot(cwd)
	if err != nil {
		return VcsResult{}, err
	}
	if strings.TrimSpace(message) == "" {
		return VcsResult{}, fmt.Errorf("a commit message is required")
	}
	// -F - rather than -m: a message with a body keeps its blank line, and
	// nothing in it can be mistaken for an option.
	out, err := gitStdin(root, message, "commit", "-F", "-")
	return VcsResult{Output: out}, err
}

// VcsStash shelves the working tree, untracked files included: a stash that
// leaves new files behind is the one that surprises people.
func (a *App) VcsStash(cwd string, message string) (VcsResult, error) {
	root, err := requireRoot(cwd)
	if err != nil {
		return VcsResult{}, err
	}
	args := []string{"stash", "push", "--include-untracked"}
	if strings.TrimSpace(message) != "" {
		args = append(args, "-m", message)
	}
	out, err := git(root, args...)
	return VcsResult{Output: out}, err
}

func (a *App) VcsStashPop(cwd string, ref string) (VcsResult, error) {
	root, err := requireRoot(cwd)
	if err != nil {
		return VcsResult{}, err
	}
	if err := checkStashRef(ref); err != nil {
		return VcsResult{}, err
	}
	out, err := git(root, "stash", "pop", ref)
	return VcsResult{Output: out}, err
}

func (a *App) VcsStashDrop(cwd string, ref string) (VcsResult, error) {
	root, err := requireRoot(cwd)
	if err != nil {
		return VcsResult{}, err
	}
	if err := checkStashRef(ref); err != nil {
		return VcsResult{}, err
	}
	out, err := git(root, "stash", "drop", ref)
	return VcsResult{Output: out}, err
}

func checkStashRef(ref string) error {
	if !strings.HasPrefix(ref, "stash@{") || !strings.HasSuffix(ref, "}") {
		return fmt.Errorf("not a stash reference: %s", ref)
	}
	return nil
}

// VcsPull is a plain `git pull`, so the user's own pull.rebase / pull.ff
// configuration decides how the histories meet. Credentials are never
// prompted for (GIT_TERMINAL_PROMPT=0): a remote that wants a password fails
// with git's message, and the terminal beside the panel is the place to sort
// that out.
func (a *App) VcsPull(cwd string) (VcsResult, error) {
	root, err := requireRoot(cwd)
	if err != nil {
		return VcsResult{}, err
	}
	out, err := gitBoth(root, "pull")
	return VcsResult{Output: out}, err
}

// VcsPush pushes the current branch. A branch with no upstream is pushed to
// the first remote with -u, which is what a first push wants and what git's
// own "fatal: no upstream" message tells you to type.
func (a *App) VcsPush(cwd string) (VcsResult, error) {
	root, err := requireRoot(cwd)
	if err != nil {
		return VcsResult{}, err
	}
	st, err := a.VcsStatus(cwd)
	if err != nil {
		return VcsResult{}, err
	}
	if st.Upstream != "" {
		out, err := gitBoth(root, "push")
		return VcsResult{Output: out}, err
	}
	if st.Branch == "" {
		return VcsResult{}, fmt.Errorf("HEAD is detached; check out a branch to push")
	}
	remote, err := firstRemote(root)
	if err != nil {
		return VcsResult{}, err
	}
	out, err := gitBoth(root, "push", "-u", remote, st.Branch)
	return VcsResult{Output: out}, err
}

// VcsSync is pull then push — the two things "get in step with the remote"
// means, in the order that cannot be rejected as non-fast-forward.
func (a *App) VcsSync(cwd string) (VcsResult, error) {
	pulled, err := a.VcsPull(cwd)
	if err != nil {
		return pulled, err
	}
	pushed, err := a.VcsPush(cwd)
	out := strings.TrimSpace(pulled.Output + "\n" + pushed.Output)
	return VcsResult{Output: out}, err
}

func firstRemote(root string) (string, error) {
	out, err := gitQuery(root, "remote")
	if err != nil {
		return "", err
	}
	remotes := strings.Fields(out)
	if len(remotes) == 0 {
		return "", fmt.Errorf("this repository has no remote to push to")
	}
	for _, r := range remotes {
		if r == "origin" {
			return r, nil
		}
	}
	return remotes[0], nil
}

// ── running git, the other ways ─────────────────────────────────────
//
// gitWithin (worktree.go) returns stdout and turns a non-zero exit into an
// error carrying stderr. That is right for queries, but pull and push say what
// they did on stderr even when they succeed, `diff --no-index` exits 1 as its
// way of saying "different", and `commit -F -` reads its message from stdin.

// runGitFull is the general form: stdin fed, both streams captured, exit code
// reported rather than judged.
func runGitFull(dir string, timeout time.Duration, stdin string, args ...string) (stdout, stderr string, code int, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var out, errb strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errb

	runErr := cmd.Run()
	stdout, stderr = out.String(), errb.String()
	if ctx.Err() == context.DeadlineExceeded {
		return stdout, stderr, -1, fmt.Errorf("git %s timed out", args[0])
	}
	if exitErr, ok := runErr.(*exec.ExitError); ok {
		return stdout, stderr, exitErr.ExitCode(), nil
	}
	if runErr != nil {
		return stdout, stderr, -1, fmt.Errorf("git %s: %w", args[0], runErr)
	}
	return stdout, stderr, 0, nil
}

// gitBoth returns stdout and stderr interleaved as one transcript — what the
// panel shows after a pull or push — and an error naming stderr on failure.
func gitBoth(dir string, args ...string) (string, error) {
	stdout, stderr, code, err := runGitFull(dir, gitTimeout, "", args...)
	transcript := strings.TrimSpace(strings.TrimSpace(stdout) + "\n" + strings.TrimSpace(stderr))
	if err != nil {
		return transcript, err
	}
	if code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = fmt.Sprintf("git %s exited with status %d", args[0], code)
		}
		return transcript, fmt.Errorf("%s", msg)
	}
	return transcript, nil
}

// gitStdin runs git with a message on stdin; used for commit -F -.
func gitStdin(dir string, stdin string, args ...string) (string, error) {
	stdout, stderr, code, err := runGitFull(dir, gitTimeout, stdin, args...)
	if err != nil {
		return "", err
	}
	if code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		return "", fmt.Errorf("%s", msg)
	}
	return strings.TrimSpace(stdout), nil
}

// gitDiffNoIndex diffs an untracked path against nothing. Exit 1 means "they
// differ", which for a file against /dev/null is the only outcome there is.
func gitDiffNoIndex(root string, path string) (string, error) {
	stdout, stderr, code, err := runGitFull(root, gitQueryTimeout, "", "diff", "--no-index", "--", os.DevNull, path)
	if err != nil {
		return "", err
	}
	if code > 1 {
		return "", fmt.Errorf("%s", strings.TrimSpace(stderr))
	}
	return stdout, nil
}
