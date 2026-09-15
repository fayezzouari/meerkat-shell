package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
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

// Bounded, because the prompt waits on this and the pane accepts no keystrokes
// until the prompt is drawn: a git that hangs (a stalled network mount, a
// wedged fsmonitor or credential helper) would otherwise freeze the pane for
// good. On a timeout the prompt simply shows the bare directory.
func runGit(cwd string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitQueryTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")
	// Otherwise Output() waits for a child holding the pipe (a hook, ssh) even
	// after git itself was killed on timeout.
	cmd.WaitDelay = time.Second
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
