package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// The environment a user's own scripts should run in — theirs, not the app's.
//
// Opened from Spotlight, Meerkat.app gets launchd's environment: PATH is
// /usr/bin:/bin:/usr/sbin:/sbin and nothing the user exported in .zshrc exists.
// git is in /usr/bin so the panels never notice, but a worktree setup script
// that calls npm, direnv or a tool from ~/.local/bin would fail here and work
// in the terminal next to it. So the shell is asked once what it exports —
// interactive and login, the same way the engine does it (see ShellEnv in the
// daemon) — and scripts get that.

const shellEnvMarker = "__MEERKAT_ENV__"
const shellEnvTimeout = 5 * time.Second

var (
	shellEnvOnce   sync.Once
	shellEnvCached []string
)

// userEnviron returns the user's login-shell environment, falling back to the
// process's own if the shell cannot be asked. Captured once per app run.
func userEnviron() []string {
	shellEnvOnce.Do(func() {
		shellEnvCached = captureShellEnv()
		if shellEnvCached == nil {
			shellEnvCached = os.Environ()
		}
	})
	return shellEnvCached
}

func captureShellEnv() []string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	if _, err := os.Stat(shell); err != nil {
		shell = "/bin/sh"
	}

	ctx, cancel := context.WithTimeout(context.Background(), shellEnvTimeout)
	defer cancel()

	// The marker separates rc-file chatter (a banner, a fetch tool) from the
	// listing; only what follows its last occurrence is read.
	cmd := exec.CommandContext(ctx, shell, "-ilc", "printf '\\0"+shellEnvMarker+"\\0'; env -0")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	cmd.Stdin = nil
	var out bytes.Buffer
	cmd.Stdout = &out
	// stderr dropped: a noisy rc file is not a failure.
	_ = cmd.Run()

	return parseShellEnv(out.Bytes())
}

// parseShellEnv reads `env -0` output that follows the marker. Returns nil
// when no marker was printed, which means the shell never got that far.
func parseShellEnv(raw []byte) []string {
	marker := []byte(shellEnvMarker + "\x00")
	at := bytes.LastIndex(raw, marker)
	if at < 0 {
		return nil
	}
	var env []string
	for _, entry := range bytes.Split(raw[at+len(marker):], []byte{0}) {
		if len(entry) == 0 {
			continue
		}
		s := string(entry)
		if k, _, ok := strings.Cut(s, "="); ok && k != "" {
			env = append(env, s)
		}
	}
	if len(env) == 0 {
		return nil
	}
	return env
}
