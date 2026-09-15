package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Mirrors MeerkatDaemon.Evaluator's @builtins, for completion only.
var builtins = []string{"cd", "exit", "quit", "jobs", "fg", "bg", "kill", "stop", "engine"}

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

// Complete returns full candidate tokens (not just the suffix) for the token
// under the cursor. isCommand means `word` is in command position.
func (a *App) Complete(word string, cwd string, isCommand bool) []string {
	if isCommand {
		return commandCandidates(word)
	}
	return pathCandidates(word, cwd)
}

// matchTier ranks how `query` matches `name` (both lowercased); lower is
// better, -1 is no match:
//
//	0: name starts with query
//	1: query starts right after a name-word separator (-, _, ., /)
//	2: query occurs anywhere else in name
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

// rankedCandidates buckets `items` by matchTier, sorts each tier
// alphabetically, and concatenates best-tier-first.
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

// The word arrives as typed, so a space inside a name is backslash-escaped
// (`My\ Dir/`) and a leading `~` is the home directory. Candidates go back the
// same way: the typed `~` is kept rather than expanded, and spaces and the
// handful of characters the daemon's tokenizer or the shell would otherwise
// split on or interpret are escaped — which is also what keeps the frontend's
// word boundary (an unescaped space) intact.
func pathCandidates(prefix string, cwd string) []string {
	dirPart, filePart := filepath.Split(unescapeWord(prefix))

	lookupDir := dirPart
	if dirPart == "" {
		lookupDir = cwd
	} else if strings.HasPrefix(dirPart, "~/") || dirPart == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			lookupDir = filepath.Join(home, strings.TrimPrefix(dirPart, "~"))
		}
	} else if !filepath.IsAbs(dirPart) {
		lookupDir = filepath.Join(cwd, dirPart)
	}

	entries, err := os.ReadDir(lookupDir)
	if err != nil {
		return nil
	}

	names := make(map[string]string, len(entries)) // candidate -> entry name
	var candidates []string
	for _, e := range entries {
		// Hide dotfiles unless a leading dot was typed, like zsh/bash.
		if strings.HasPrefix(e.Name(), ".") && !strings.HasPrefix(filePart, ".") {
			continue
		}
		cand := escapeWord(dirPart + e.Name())
		if e.IsDir() {
			cand += "/"
		}
		names[cand] = e.Name()
		candidates = append(candidates, cand)
	}

	return rankedCandidates(candidates, strings.ToLower(filePart), func(cand string) string { return names[cand] })
}

// Characters that end a word or mean something to the shell when unescaped.
const wordSpecials = " \t\"'\\$&|;<>()*?[]#~`!"

func escapeWord(s string) string {
	var b strings.Builder
	for i, r := range s {
		// A leading `~` is the home directory and must stay bare; anywhere
		// else it is literal only when escaped.
		if strings.ContainsRune(wordSpecials, r) && !(r == '~' && i == 0) {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

func unescapeWord(s string) string {
	var b strings.Builder
	escaped := false
	for _, r := range s {
		if escaped {
			b.WriteRune(r)
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		b.WriteRune(r)
	}
	if escaped {
		b.WriteByte('\\')
	}
	return b.String()
}
