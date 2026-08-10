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

// matchTier ranks how `query` matches `name` (both should already be
// lowercased), lower is better, -1 means no match at all:
//
//	0: name starts with query — typing "gi" and getting "git" first
//	1: query starts right after a name-word separator (-, _, ., /) —
//	   typing "fr" finds "prontooo-frontend" (matches at the start of the
//	   "frontend" segment) ranked above...
//	2: query occurs anywhere else in name — ...e.g. "infra", where "fr"
//	   is buried mid-word with no separator before it. Still surfaced
//	   (better to overmatch than to miss a real candidate), just last.
func matchTier(name, query string) int {
	if query == "" || strings.HasPrefix(name, query) {
		return 0
	}
	idx := strings.Index(name, query)
	if idx < 0 {
		return -1
	}
	if isNameSeparator(name[idx-1]) {
		return 1
	}
	return 2
}

func isNameSeparator(b byte) bool {
	return b == '-' || b == '_' || b == '.' || b == '/'
}

// rankedCandidates buckets `items` (already resolved to their display
// strings) by matchTier against `query`, sorting each tier alphabetically,
// then concatenates best-tier-first.
func rankedCandidates(items []string, lowerQuery string, keyOf func(string) string) []string {
	var tiers [3][]string
	for _, item := range items {
		tier := matchTier(strings.ToLower(keyOf(item)), lowerQuery)
		if tier < 0 {
			continue
		}
		tiers[tier] = append(tiers[tier], item)
	}
	var out []string
	for _, tier := range tiers {
		sort.Strings(tier)
		out = append(out, tier...)
	}
	return out
}

func commandCandidates(prefix string) []string {
	pathCmdsOnce.Do(loadPathCmds)

	seen := make(map[string]bool)
	var names []string
	for _, name := range append(append([]string{}, builtins...), pathCmds...) {
		if seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}

	return rankedCandidates(names, strings.ToLower(prefix), func(s string) string { return s })
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

	names := make(map[string]string, len(entries)) // candidate string -> entry name (for matching)
	var candidates []string
	for _, e := range entries {
		cand := dirPart + e.Name()
		if e.IsDir() {
			cand += "/"
		}
		names[cand] = e.Name()
		candidates = append(candidates, cand)
	}

	return rankedCandidates(candidates, strings.ToLower(filePart), func(cand string) string { return names[cand] })
}
