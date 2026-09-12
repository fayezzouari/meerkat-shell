package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseStatusV2(t *testing.T) {
	// The -z form: NUL-terminated records, a rename's original path as its own
	// field, a path with a space kept whole.
	out := strings.Join([]string{
		"# branch.oid 0123456789abcdef0123456789abcdef01234567",
		"# branch.head main",
		"# branch.upstream origin/main",
		"# branch.ab +2 -1",
		"1 M. N... 100644 100644 100644 aaaa bbbb staged.go",
		"1 .M N... 100644 100644 100644 aaaa aaaa unstaged.go",
		"1 MM N... 100644 100644 100644 aaaa bbbb both.go",
		"2 R. N... 100644 100644 100644 aaaa aaaa R100 new name.go",
		"old name.go",
		"u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.go",
		"? fresh.txt",
		"",
	}, "\x00")

	st := parseStatusV2(out)
	if st.Head != "01234567" || st.Branch != "main" || st.Upstream != "origin/main" {
		t.Fatalf("header: %+v", st)
	}
	if st.Ahead != 2 || st.Behind != 1 {
		t.Fatalf("ahead/behind: %d/%d", st.Ahead, st.Behind)
	}
	paths := func(list []VcsFile) []string {
		var p []string
		for _, f := range list {
			p = append(p, f.Path)
		}
		return p
	}
	if got := paths(st.Staged); strings.Join(got, ",") != "both.go,new name.go,staged.go" {
		t.Fatalf("staged: %v", got)
	}
	if got := paths(st.Unstaged); strings.Join(got, ",") != "both.go,unstaged.go" {
		t.Fatalf("unstaged: %v", got)
	}
	if len(st.Untracked) != 1 || st.Untracked[0].Path != "fresh.txt" || !st.Untracked[0].Untracked {
		t.Fatalf("untracked: %+v", st.Untracked)
	}
	if len(st.Conflicted) != 1 || st.Conflicted[0].Path != "conflict.go" || !st.Conflicted[0].Conflicted {
		t.Fatalf("conflicted: %+v", st.Conflicted)
	}
	for _, f := range st.Staged {
		if f.Path == "new name.go" && (f.OrigPath != "old name.go" || f.Index != "R") {
			t.Fatalf("rename: %+v", f)
		}
	}
}

func TestParseStatusV2UnbornDetached(t *testing.T) {
	st := parseStatusV2("# branch.oid (initial)\x00# branch.head (detached)\x00")
	if st.Head != "" || st.Branch != "" {
		t.Fatalf("got %+v", st)
	}
}

func TestParseLogMarksUnpushed(t *testing.T) {
	out := "aaa\x1fa\x1ffirst\x1fme\x1f100\x1e" + "bbb\x1fb\x1fsecond\x1fme\x1f200\x1e"
	commits := parseLog(out, true, map[string]bool{"aaa": true})
	if len(commits) != 2 || commits[0].Pushed || !commits[1].Pushed || commits[0].Subject != "first" {
		t.Fatalf("got %+v", commits)
	}
	// No upstream: nothing can have been pushed.
	for _, c := range parseLog(out, false, nil) {
		if c.Pushed {
			t.Fatalf("pushed without an upstream: %+v", c)
		}
	}
}

func TestParseShellEnv(t *testing.T) {
	raw := []byte("banner\nPATH=/wrong\n\x00__MEERKAT_ENV__\x00PATH=/right\x00HOME=/h\x00")
	env := parseShellEnv(raw)
	if len(env) != 2 || env[0] != "PATH=/right" {
		t.Fatalf("got %v", env)
	}
	if parseShellEnv([]byte("PATH=/x\x00")) != nil {
		t.Fatal("no marker should yield nil")
	}
}

// initRepo makes a repo with one commit and returns its path.
func initRepo(t *testing.T, base string) string {
	t.Helper()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"init", "-b", "main"},
		{"config", "user.email", "test@example.com"},
		{"config", "user.name", "Test"},
	} {
		if _, err := git(root, args...); err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
	}
	write(t, filepath.Join(root, "a.txt"), "one\n")
	if _, err := git(root, "add", "a.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := git(root, "commit", "-m", "root"); err != nil {
		t.Fatal(err)
	}
	return root
}

func write(t *testing.T, path string, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestVcsLifecycleSmoke(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	base := t.TempDir()
	root := initRepo(t, base)
	app := &App{}

	// Not a repo: zero value, no error.
	if st, err := app.VcsStatus(base); err != nil || st.Root != "" {
		t.Fatalf("outside a repo: %+v %v", st, err)
	}

	// An edit, a new file, a rename.
	write(t, filepath.Join(root, "a.txt"), "one\ntwo\n")
	write(t, filepath.Join(root, "b.txt"), "new\n")
	st, err := app.VcsStatus(root)
	if err != nil {
		t.Fatal(err)
	}
	if st.Branch != "main" || len(st.Unstaged) != 1 || len(st.Untracked) != 1 || len(st.Staged) != 0 {
		t.Fatalf("after edits: %+v", st)
	}
	if st.Upstream != "" || st.HasRemote || len(st.Commits) != 1 || st.Commits[0].Pushed || st.LocalCount != 1 {
		t.Fatalf("no remote yet: %+v", st)
	}

	// Diffs for each kind.
	if d, err := app.VcsDiff(root, "a.txt", false, false); err != nil || !strings.Contains(d, "+two") {
		t.Fatalf("worktree diff: %q %v", d, err)
	}
	if d, err := app.VcsDiff(root, "b.txt", false, true); err != nil || !strings.Contains(d, "+new") {
		t.Fatalf("untracked diff: %q %v", d, err)
	}

	// Stage one, unstage it, stage all.
	if err := app.VcsStage(root, []string{"b.txt"}); err != nil {
		t.Fatal(err)
	}
	st, _ = app.VcsStatus(root)
	if len(st.Staged) != 1 || st.Staged[0].Path != "b.txt" || st.Staged[0].Index != "A" {
		t.Fatalf("after stage: %+v", st.Staged)
	}
	if d, err := app.VcsDiff(root, "b.txt", true, false); err != nil || !strings.Contains(d, "+new") {
		t.Fatalf("staged diff: %q %v", d, err)
	}
	if err := app.VcsUnstage(root, []string{"b.txt"}); err != nil {
		t.Fatal(err)
	}
	st, _ = app.VcsStatus(root)
	if len(st.Staged) != 0 || len(st.Untracked) != 1 {
		t.Fatalf("after unstage: %+v", st)
	}
	if err := app.VcsStageAll(root); err != nil {
		t.Fatal(err)
	}
	st, _ = app.VcsStatus(root)
	if len(st.Staged) != 2 || len(st.Unstaged) != 0 || len(st.Untracked) != 0 {
		t.Fatalf("after stage all: %+v", st)
	}

	// Commit with a body; the blank line must survive.
	if _, err := app.VcsCommit(root, "second\n\nwith a body"); err != nil {
		t.Fatal(err)
	}
	st, _ = app.VcsStatus(root)
	if len(st.Commits) != 2 || st.Commits[0].Subject != "second" {
		t.Fatalf("after commit: %+v", st.Commits)
	}
	if _, err := app.VcsCommit(root, "   "); err == nil {
		t.Fatal("empty message committed")
	}

	// Discard: a tracked edit goes back, an untracked file goes away.
	write(t, filepath.Join(root, "a.txt"), "changed\n")
	write(t, filepath.Join(root, "c.txt"), "junk\n")
	if err := app.VcsDiscard(root, []string{"a.txt"}, false); err != nil {
		t.Fatal(err)
	}
	if err := app.VcsDiscard(root, []string{"c.txt"}, true); err != nil {
		t.Fatal(err)
	}
	st, _ = app.VcsStatus(root)
	if len(st.Unstaged)+len(st.Untracked) != 0 {
		t.Fatalf("after discard: %+v", st)
	}
	if _, err := os.Stat(filepath.Join(root, "c.txt")); !os.IsNotExist(err) {
		t.Fatal("untracked file survived discard")
	}

	// Stash, then pop.
	write(t, filepath.Join(root, "a.txt"), "stashed\n")
	write(t, filepath.Join(root, "d.txt"), "also stashed\n")
	if _, err := app.VcsStash(root, "wip"); err != nil {
		t.Fatal(err)
	}
	st, _ = app.VcsStatus(root)
	if len(st.Stashes) != 1 || !strings.Contains(st.Stashes[0].Subject, "wip") || len(st.Unstaged)+len(st.Untracked) != 0 {
		t.Fatalf("after stash: %+v", st)
	}
	if _, err := app.VcsStashPop(root, st.Stashes[0].Ref); err != nil {
		t.Fatal(err)
	}
	st, _ = app.VcsStatus(root)
	if len(st.Stashes) != 0 || len(st.Unstaged) != 1 || len(st.Untracked) != 1 {
		t.Fatalf("after pop: %+v", st)
	}
	if _, err := app.VcsStashPop(root, "HEAD"); err == nil {
		t.Fatal("a non-stash ref was accepted")
	}
	// Clean up for the remote part.
	if err := app.VcsDiscard(root, []string{"a.txt"}, false); err != nil {
		t.Fatal(err)
	}
	if err := app.VcsDiscard(root, []string{"d.txt"}, true); err != nil {
		t.Fatal(err)
	}

	// A bare remote: first push sets the upstream, commits become "pushed",
	// a new local commit is highlighted, sync clears it.
	remote := filepath.Join(base, "remote.git")
	if out, err := exec.Command("git", "init", "--bare", remote).CombinedOutput(); err != nil {
		t.Fatalf("bare init: %v %s", err, out)
	}
	if _, err := git(root, "remote", "add", "origin", remote); err != nil {
		t.Fatal(err)
	}
	if _, err := app.VcsPush(root); err != nil {
		t.Fatalf("first push: %v", err)
	}
	st, _ = app.VcsStatus(root)
	if st.Upstream != "origin/main" || !st.HasRemote || st.LocalCount != 0 || st.Ahead != 0 {
		t.Fatalf("after push: %+v", st)
	}
	for _, c := range st.Commits {
		if !c.Pushed {
			t.Fatalf("commit still local after push: %+v", c)
		}
	}
	write(t, filepath.Join(root, "e.txt"), "local\n")
	if err := app.VcsStageAll(root); err != nil {
		t.Fatal(err)
	}
	if _, err := app.VcsCommit(root, "local only"); err != nil {
		t.Fatal(err)
	}
	st, _ = app.VcsStatus(root)
	if st.Ahead != 1 || st.LocalCount != 1 || st.Commits[0].Pushed || !st.Commits[1].Pushed {
		t.Fatalf("one local commit: ahead=%d local=%d %+v", st.Ahead, st.LocalCount, st.Commits[:2])
	}
	if _, err := app.VcsSync(root); err != nil {
		t.Fatalf("sync: %v", err)
	}
	st, _ = app.VcsStatus(root)
	if st.Ahead != 0 || st.LocalCount != 0 {
		t.Fatalf("after sync: %+v", st)
	}
	if _, err := app.VcsPull(root); err != nil {
		t.Fatalf("pull on an up-to-date branch: %v", err)
	}

	// Paths that could be read as options are refused before git sees them.
	if err := app.VcsStage(root, []string{"--all"}); err == nil {
		t.Fatal("an option-looking path was accepted")
	}
	if err := app.VcsStage(root, nil); err == nil {
		t.Fatal("no paths was accepted")
	}
}

func TestWorktreeSetupScripts(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	base := t.TempDir()
	root := initRepo(t, base)
	app := &App{}

	// A repo hook, committed alongside the code.
	if err := os.MkdirAll(filepath.Join(root, ".meerkat"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, worktreeSetupFile),
		"#!/bin/sh\necho hook in $MEERKAT_WORKTREE_NAME\ncp \"$MEERKAT_REPO_ROOT/.env\" .env\n")
	write(t, filepath.Join(root, ".env"), "SECRET=1\n")

	// The user's own script, which sees the same variables and runs first.
	script := "echo user script on $MEERKAT_BRANCH; touch from-user"

	created, err := app.CreateWorktree(root, "feature/env", "", script)
	if err != nil {
		t.Fatal(err)
	}
	if !created.SetupRan || created.SetupError != "" {
		t.Fatalf("setup: %+v", created)
	}
	if !strings.Contains(created.SetupOutput, "user script on feature/env") ||
		!strings.Contains(created.SetupOutput, "hook in feature-env") {
		t.Fatalf("transcript: %q", created.SetupOutput)
	}
	if _, err := os.Stat(filepath.Join(created.Path, "from-user")); err != nil {
		t.Fatal("user script did not run in the worktree")
	}
	if body, err := os.ReadFile(filepath.Join(created.Path, ".env")); err != nil || string(body) != "SECRET=1\n" {
		t.Fatalf(".env was not copied by the hook: %q %v", body, err)
	}

	// A failing script is reported, not fatal: the worktree still exists.
	created, err = app.CreateWorktree(root, "feature/broken", "", "echo before; exit 3")
	if err != nil {
		t.Fatal(err)
	}
	if created.SetupError == "" || !strings.Contains(created.SetupOutput, "before") {
		t.Fatalf("failure not reported: %+v", created)
	}
	if _, err := os.Stat(created.Path); err != nil {
		t.Fatal("worktree missing after a failed setup script")
	}
}
