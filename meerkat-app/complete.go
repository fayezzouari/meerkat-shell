package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// builtins mirrors MeerkatDaemon.Evaluator's @builtins — kept here only so
// Tab completion knows about them, not to duplicate any execution logic.
var builtins = []string{"cd", "exit", "quit", "jobs", "fg", "bg", "kill", "stop"}

var (
	pathCmdsOnce sync.Once
	pathCmds     []string
)

func loadPathCmds() {
	seen := make(map[string]bool)
	for _, dir := range strings.Split(os.Getenv("PATH"), string(os.PathListSeparator)) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || seen[e.Name()] {
				continue
			}
			seen[e.Name()] = true
			pathCmds = append(pathCmds, e.Name())
		}
	}
}

// Complete returns full candidate tokens (word already included, not just
// the suffix) for the token `word` under the cursor. isCommand is true
// when `word` is the first token on the line (command position); path
// completion is resolved relative to cwd otherwise. Called from JS on Tab.
func (a *App) Complete(word string, cwd string, isCommand bool) []string {
	if isCommand {
		return commandCandidates(word)
	}
	return pathCandidates(word, cwd)
}

func commandCandidates(prefix string) []string {
	pathCmdsOnce.Do(loadPathCmds)

	seen := make(map[string]bool)
	var out []string
	for _, name := range builtins {
		if strings.HasPrefix(name, prefix) && !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	for _, name := range pathCmds {
		if strings.HasPrefix(name, prefix) && !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

func pathCandidates(prefix string, cwd string) []string {
	dirPart, filePart := filepath.Split(prefix)

	lookupDir := dirPart
	if dirPart == "" {
		lookupDir = cwd
	} else if !filepath.IsAbs(dirPart) {
		lookupDir = filepath.Join(cwd, dirPart)
	}

	entries, err := os.ReadDir(lookupDir)
	if err != nil {
		return nil
	}

	var out []string
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), filePart) {
			continue
		}
		cand := dirPart + e.Name()
		if e.IsDir() {
			cand += "/"
		}
		out = append(out, cand)
	}
	sort.Strings(out)
	return out
}
