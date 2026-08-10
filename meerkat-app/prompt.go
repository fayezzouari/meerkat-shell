package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// HomeDir returns the user's home directory, used by the frontend to
// shorten the prompt's cwd display to "~" / "~/sub/dir" the same way a
// real shell does. Best-effort: an empty string just means the frontend
// shows the cwd unshortened.
func (a *App) HomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

// GitStatus is what the frontend needs to swap the prompt's path display
// for "<repo> <branch> <subpath>" when cwd is inside a git working tree.
type GitStatus struct {
	Repo    string `json:"repo"`
	Branch  string `json:"branch"`
	Subpath string `json:"subpath"` // cwd's path relative to the repo root, with a leading "/"; "" at the root itself
}

// GitInfo reports the repo name (the git root directory's basename),
// current branch, and cwd's path relative to the repo root, or a
// zero-value GitStatus if cwd isn't inside a git working tree. Shells out
// to the `git` binary rather than reading .git/ directly — same "call an
// OS command from the GUI's own Go process" pattern complete.go already
// uses for tab completion, since this runs on the same machine as the
// directories it's inspecting.
func (a *App) GitInfo(cwd string) GitStatus {
	root, err := runGit(cwd, "rev-parse", "--show-toplevel")
	if err != nil || root == "" {
		return GitStatus{}
	}

	branch, err := runGit(cwd, "symbolic-ref", "--short", "HEAD")
	if err != nil || branch == "" {
		// Detached HEAD: fall back to a short commit hash.
		branch, _ = runGit(cwd, "rev-parse", "--short", "HEAD")
	}

	subpath := ""
	if rel, err := filepath.Rel(root, cwd); err == nil && rel != "." {
		subpath = "/" + rel
	}

	return GitStatus{Repo: filepath.Base(root), Branch: branch, Subpath: subpath}
}

func runGit(cwd string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
