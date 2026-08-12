package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// HomeDir is best-effort: "" means the frontend shows the cwd unshortened.
func (a *App) HomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

type GitStatus struct {
	Repo    string `json:"repo"`
	Branch  string `json:"branch"`
	Subpath string `json:"subpath"` // relative to the repo root, leading "/"; "" at the root
}

// GitInfo returns a zero-value GitStatus if cwd isn't inside a working tree.
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

	// Asked of git rather than computed as filepath.Rel(root, cwd):
	// --show-toplevel resolves symlinks but the daemon's cwd may not, which
	// produced a nonsensical "../../.." even at the repo root.
	subpath := ""
	if prefix, err := runGit(cwd, "rev-parse", "--show-prefix"); err == nil && prefix != "" {
		subpath = "/" + strings.TrimSuffix(prefix, "/")
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
