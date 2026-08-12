package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Git worktree management for the sidebar. Everything here shells out to the
// real `git` binary rather than reimplementing the plumbing: worktrees have
// enough edge cases (linked .git files, locked entries, prunable strays) that
// git's own bookkeeping is the only thing worth trusting.

// gitTimeout bounds every git invocation. A worktree add against a large repo
// can be slow, but the sidebar polls on a 2s timer — a git call that hangs
// forever (credential prompt on a network remote, say) would otherwise pile up
// goroutines for the life of the app.
const gitTimeout = 60 * time.Second

// defaultWorktreeDir is the template used when the user hasn't set one:
// a sibling directory next to the repo, so worktrees never appear as
// untracked paths inside the working tree.
const defaultWorktreeDir = "../<repo>-worktrees"

// maxWorktreesScanned caps the per-refresh dirty-status checks. Each one is a
// `git status` process, and the sidebar reruns this every 2 seconds.
const maxWorktreesScanned = 32

type WorktreeInfo struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Branch   string `json:"branch"`   // short name, or "" when detached
	Head     string `json:"head"`     // abbreviated commit
	IsMain   bool   `json:"isMain"`   // the repo's original working tree
	Detached bool   `json:"detached"`
	Locked   bool   `json:"locked"`
	Prunable bool   `json:"prunable"` // git considers the entry stale
	Missing  bool   `json:"missing"`  // path no longer exists on disk
	Dirty    bool   `json:"dirty"`    // uncommitted changes, untracked included
}

// RepoStatus is the whole payload the sidebar's worktree section renders from.
// A cwd outside any repo yields a zero value with a nil error — "not a repo"
// is an ordinary state for a terminal pane, not a failure worth reporting.
type RepoStatus struct {
	Root        string         `json:"root"`        // main worktree's root, "" if not a repo
	Name        string         `json:"name"`        // basename of Root
	WorktreeDir string         `json:"worktreeDir"` // resolved absolute dir new worktrees land in
	Worktrees   []WorktreeInfo `json:"worktrees"`
}

func git(dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	// Never let git stop for input: a worktree add that needs credentials must
	// fail with a message, not block the webview's IPC call forever.
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")

	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("git %s timed out", args[0])
		}
		if msg == "" {
			return "", fmt.Errorf("git %s: %w", args[0], err)
		}
		return "", fmt.Errorf("%s", msg)
	}
	return string(out), nil
}

// RepoStatus reports the repo containing cwd along with its worktrees.
// dirTemplate is the user's worktree-directory preference ("" for the default).
func (a *App) RepoStatus(cwd string, dirTemplate string) (RepoStatus, error) {
	if cwd == "" {
		return RepoStatus{}, nil
	}
	if info, err := os.Stat(cwd); err != nil || !info.IsDir() {
		return RepoStatus{}, nil
	}

	out, err := git(cwd, "worktree", "list", "--porcelain")
	if err != nil {
		// The overwhelmingly common cause is "not a git repository", which is
		// not an error condition for a terminal pane. Distinguish it from a
		// real git failure by asking directly.
		if _, e := git(cwd, "rev-parse", "--is-inside-work-tree"); e != nil {
			return RepoStatus{}, nil
		}
		return RepoStatus{}, err
	}

	worktrees := parseWorktreeList(out)
	if len(worktrees) == 0 {
		return RepoStatus{}, nil
	}
	// `git worktree list` always emits the main worktree first.
	worktrees[0].IsMain = true
	root := worktrees[0].Path

	fillDirtyStatus(worktrees)

	dir, err := resolveWorktreeDir(root, dirTemplate)
	if err != nil {
		return RepoStatus{}, err
	}

	return RepoStatus{
		Root:        root,
		Name:        filepath.Base(root),
		WorktreeDir: dir,
		Worktrees:   worktrees,
	}, nil
}

// mainWorktreeRoot returns the root of the repo's original working tree, or ""
// if cwd isn't in a repo. Cheaper than RepoStatus for the mutating calls,
// which don't need every worktree's dirty status.
func mainWorktreeRoot(cwd string) (string, error) {
	out, err := git(cwd, "worktree", "list", "--porcelain")
	if err != nil {
		if _, e := git(cwd, "rev-parse", "--is-inside-work-tree"); e != nil {
			return "", nil
		}
		return "", err
	}
	list := parseWorktreeList(out)
	if len(list) == 0 {
		return "", nil
	}
	return list[0].Path, nil
}

// parseWorktreeList reads `git worktree list --porcelain`: blank-line-separated
// stanzas of "<attr>[ <value>]" lines, one stanza per worktree.
func parseWorktreeList(out string) []WorktreeInfo {
	var list []WorktreeInfo
	var current *WorktreeInfo

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			if current != nil {
				list = append(list, *current)
				current = nil
			}
			continue
		}

		key, value, _ := strings.Cut(line, " ")
		switch key {
		case "worktree":
			current = &WorktreeInfo{Path: value, Name: filepath.Base(value)}
		case "HEAD":
			if current != nil && len(value) >= 8 {
				current.Head = value[:8]
			}
		case "branch":
			if current != nil {
				current.Branch = strings.TrimPrefix(value, "refs/heads/")
			}
		case "detached":
			if current != nil {
				current.Detached = true
			}
		case "locked":
			if current != nil {
				current.Locked = true
			}
		case "prunable":
			if current != nil {
				current.Prunable = true
			}
		}
	}
	// A trailing stanza with no blank line after it (git omits it on some
	// versions when the output doesn't end in a newline).
	if current != nil {
		list = append(list, *current)
	}
	return list
}

// fillDirtyStatus marks each worktree that has uncommitted work, in parallel:
// serially, a repo with a dozen worktrees would take longer than the sidebar's
// own refresh interval.
func fillDirtyStatus(worktrees []WorktreeInfo) {
	var wg sync.WaitGroup
	for i := range worktrees {
		if i >= maxWorktreesScanned {
			break
		}
		wg.Add(1)
		go func(w *WorktreeInfo) {
			defer wg.Done()
			if info, err := os.Stat(w.Path); err != nil || !info.IsDir() {
				w.Missing = true
				return
			}
			out, err := git(w.Path, "status", "--porcelain")
			if err != nil {
				return
			}
			w.Dirty = strings.TrimSpace(out) != ""
		}(&worktrees[i])
	}
	wg.Wait()
}

// resolveWorktreeDir turns the user's directory preference into an absolute
// path. "<repo>" expands to the repo's basename, "~" to the home directory,
// and a relative path resolves against the repo root — so the default
// "../<repo>-worktrees" lands beside the repo.
func resolveWorktreeDir(root string, template string) (string, error) {
	template = strings.TrimSpace(template)
	if template == "" {
		template = defaultWorktreeDir
	}
	template = strings.ReplaceAll(template, "<repo>", filepath.Base(root))

	if strings.HasPrefix(template, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("cannot expand ~: %w", err)
		}
		template = filepath.Join(home, strings.TrimPrefix(template, "~"))
	}
	if !filepath.IsAbs(template) {
		template = filepath.Join(root, template)
	}
	return filepath.Clean(template), nil
}

// validateWorktreeName rejects names that would escape the worktree directory
// or confuse git. Slashes are allowed — "feature/login" is an ordinary branch
// name — but they're flattened for the directory name by CreateWorktree.
func validateWorktreeName(name string) error {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		return fmt.Errorf("name is required")
	case strings.HasPrefix(name, "-"):
		return fmt.Errorf("name cannot start with '-'")
	case filepath.IsAbs(name):
		return fmt.Errorf("name must not be an absolute path")
	case strings.Contains(name, ".."):
		return fmt.Errorf("name must not contain '..'")
	case strings.ContainsAny(name, "\x00\n\r\t~^:?*[\\ "):
		return fmt.Errorf("name contains a character git doesn't allow in a branch")
	}
	return nil
}

// CreateWorktree adds a worktree for `name` under the resolved worktree
// directory. If a local branch called `name` already exists it's checked out;
// otherwise a new branch of that name is created from HEAD. Returns the new
// worktree's path so the frontend can open a tab there.
func (a *App) CreateWorktree(cwd string, name string, dirTemplate string) (string, error) {
	name = strings.TrimSpace(name)
	if err := validateWorktreeName(name); err != nil {
		return "", err
	}

	root, err := mainWorktreeRoot(cwd)
	if err != nil {
		return "", err
	}
	if root == "" {
		return "", fmt.Errorf("%s is not inside a git repository", cwd)
	}
	worktreeDir, err := resolveWorktreeDir(root, dirTemplate)
	if err != nil {
		return "", err
	}

	// Slashes are legal in the branch name but would nest the checkout a level
	// deeper than the sidebar's flat listing implies.
	dirName := strings.ReplaceAll(name, "/", "-")
	path := filepath.Join(worktreeDir, dirName)

	if _, err := os.Stat(path); err == nil {
		return "", fmt.Errorf("%s already exists", path)
	}
	if err := os.MkdirAll(worktreeDir, 0o755); err != nil {
		return "", fmt.Errorf("cannot create %s: %w", worktreeDir, err)
	}

	// Run from the main worktree: cwd may itself be a worktree that's about to
	// be operated on, and git resolves relative paths against it either way.
	branchExists := false
	if _, err := git(root, "rev-parse", "--verify", "--quiet", "refs/heads/"+name); err == nil {
		branchExists = true
	}

	if branchExists {
		_, err = git(root, "worktree", "add", path, name)
	} else {
		_, err = git(root, "worktree", "add", "-b", name, path)
	}
	if err != nil {
		return "", err
	}
	return path, nil
}

// RemoveWorktree deletes a linked worktree. The main worktree is refused: git
// would too, but the error it gives ("is a main working tree") reads like a
// bug rather than a guard. force discards uncommitted changes.
func (a *App) RemoveWorktree(cwd string, path string, force bool) error {
	root, err := mainWorktreeRoot(cwd)
	if err != nil {
		return err
	}
	if root == "" {
		return fmt.Errorf("%s is not inside a git repository", cwd)
	}
	if filepath.Clean(path) == filepath.Clean(root) {
		return fmt.Errorf("the repo's main working tree can't be removed")
	}

	args := []string{"worktree", "remove"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, path)

	if _, err := git(root, args...); err != nil {
		return err
	}
	// A worktree whose directory vanished underneath git leaves a stale
	// administrative entry that would keep showing up in the list.
	git(root, "worktree", "prune")
	return nil
}
