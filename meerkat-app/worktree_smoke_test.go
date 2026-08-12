package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestParseWorktreeList(t *testing.T) {
	out := "worktree /repo/meerkat\nHEAD 1234567890abcdef\nbranch refs/heads/main\n\n" +
		"worktree /repo/meerkat-worktrees/feature-x\nHEAD abcdef1234567890\nbranch refs/heads/feature/x\n\n" +
		"worktree /repo/meerkat-worktrees/loose\nHEAD 0f0f0f0f0f0f0f0f\ndetached\nprunable gitdir file points to non-existent location\n\n"

	list := parseWorktreeList(out)
	if len(list) != 3 {
		t.Fatalf("got %d worktrees, want 3: %+v", len(list), list)
	}

	if list[0].Path != "/repo/meerkat" || list[0].Branch != "main" || list[0].Name != "meerkat" {
		t.Fatalf("main worktree: %+v", list[0])
	}
	if list[0].Head != "12345678" {
		t.Fatalf("head abbreviated to %q, want 12345678", list[0].Head)
	}
	if list[1].Branch != "feature/x" || list[1].Name != "feature-x" {
		t.Fatalf("linked worktree: %+v", list[1])
	}
	if !list[2].Detached || !list[2].Prunable || list[2].Branch != "" {
		t.Fatalf("detached worktree: %+v", list[2])
	}
}

// git omits the trailing blank line in some versions.
func TestParseWorktreeListNoTrailingBlank(t *testing.T) {
	list := parseWorktreeList("worktree /repo/x\nHEAD 1234567890\nbranch refs/heads/main")
	if len(list) != 1 || list[0].Branch != "main" {
		t.Fatalf("got %+v", list)
	}
}

func TestResolveWorktreeDir(t *testing.T) {
	root := "/home/dev/meerkat"
	cases := []struct {
		template string
		want     string
	}{
		{"", "/home/dev/meerkat-worktrees"},
		{"../<repo>-worktrees", "/home/dev/meerkat-worktrees"},
		{".meerkat/worktrees", "/home/dev/meerkat/.meerkat/worktrees"},
		{"./.meerkat/worktrees", "/home/dev/meerkat/.meerkat/worktrees"},
		{"/tmp/wt/<repo>", "/tmp/wt/meerkat"},
	}
	for _, c := range cases {
		got, err := resolveWorktreeDir(root, c.template)
		if err != nil {
			t.Fatalf("%q: %v", c.template, err)
		}
		if got != filepath.Clean(c.want) {
			t.Fatalf("%q: got %q, want %q", c.template, got, c.want)
		}
	}
}

func TestValidateWorktreeName(t *testing.T) {
	valid := []string{"feature-x", "feature/x", "fix.123"}
	for _, name := range valid {
		if err := validateWorktreeName(name); err != nil {
			t.Fatalf("%q rejected: %v", name, err)
		}
	}

	invalid := []string{"", "  ", "-force", "../escape", "a b", "/abs/path", "has~tilde", "x:y"}
	for _, name := range invalid {
		if err := validateWorktreeName(name); err == nil {
			t.Fatalf("%q accepted, want rejected", name)
		}
	}
}

// Exercises the create/list/remove round trip against a real git binary — the
// parsing above is only as good as the porcelain format it assumes.
func TestWorktreeRoundTrip(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}

	// Resolved, because git reports real paths and macOS's temp dir is a
	// symlink (/var -> /private/var).
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"init", "-b", "main"},
		{"config", "user.email", "test@example.com"},
		{"config", "user.name", "Test"},
		{"commit", "--allow-empty", "-m", "root"},
	} {
		if _, err := git(root, args...); err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
	}

	app := &App{}

	status, err := app.RepoStatus(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Worktrees) != 1 || !status.Worktrees[0].IsMain {
		t.Fatalf("fresh repo: %+v", status)
	}
	if want := filepath.Join(base, "repo-worktrees"); status.WorktreeDir != want {
		t.Fatalf("WorktreeDir = %q, want %q", status.WorktreeDir, want)
	}

	path, err := app.CreateWorktree(root, "feature/x", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if want := filepath.Join(base, "repo-worktrees", "feature-x"); path != want {
		t.Fatalf("created at %q, want %q", path, want)
	}

	status, err = app.RepoStatus(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Worktrees) != 2 {
		t.Fatalf("after create: %+v", status.Worktrees)
	}
	wt := status.Worktrees[1]
	if wt.Branch != "feature/x" || wt.IsMain || wt.Dirty {
		t.Fatalf("new worktree: %+v", wt)
	}

	// A creation that collides should fail rather than clobber.
	if _, err := app.CreateWorktree(root, "feature/x", ""); err == nil {
		t.Fatal("duplicate create succeeded, want error")
	}

	// Dirty state must surface, and removal must then need force.
	if err := os.WriteFile(filepath.Join(path, "scratch.txt"), []byte("wip"), 0o644); err != nil {
		t.Fatal(err)
	}
	status, _ = app.RepoStatus(root, "")
	if !status.Worktrees[1].Dirty {
		t.Fatal("untracked file did not mark the worktree dirty")
	}
	if err := app.RemoveWorktree(root, path, false); err == nil {
		t.Fatal("removing a dirty worktree without force succeeded, want error")
	}

	if err := app.RemoveWorktree(root, root, true); err == nil {
		t.Fatal("removing the main worktree succeeded, want error")
	}

	if err := app.RemoveWorktree(root, path, true); err != nil {
		t.Fatalf("forced remove: %v", err)
	}
	status, _ = app.RepoStatus(root, "")
	if len(status.Worktrees) != 1 {
		t.Fatalf("after remove: %+v", status.Worktrees)
	}
}
