package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// pathCompleter implements readline.AutoCompleter: the first word completes
// against builtins + $PATH, later words against the daemon cwd's entries.
type pathCompleter struct {
	cwd *string

	once     sync.Once
	pathCmds []string
}

func (c *pathCompleter) Do(line []rune, pos int) (newLine [][]rune, length int) {
	text := string(line[:pos])
	start := lastWordStart(text)
	word := text[start:]

	var candidates []string
	if start == 0 {
		candidates = c.commandCandidates(word)
	} else {
		candidates = c.pathCandidates(word)
	}

	newLine = make([][]rune, 0, len(candidates))
	for _, cand := range candidates {
		newLine = append(newLine, []rune(cand[len(word):]))
	}
	return newLine, len(word)
}

func lastWordStart(text string) int {
	if idx := strings.LastIndexAny(text, " \t"); idx != -1 {
		return idx + 1
	}
	return 0
}

func (c *pathCompleter) commandCandidates(prefix string) []string {
	c.once.Do(c.loadPathCmds)

	seen := make(map[string]bool)
	var out []string
	for _, name := range builtins {
		if strings.HasPrefix(name, prefix) && !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	for _, name := range c.pathCmds {
		if strings.HasPrefix(name, prefix) && !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

func (c *pathCompleter) loadPathCmds() {
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
			c.pathCmds = append(c.pathCmds, e.Name())
		}
	}
}

func (c *pathCompleter) pathCandidates(prefix string) []string {
	dirPart, filePart := filepath.Split(prefix)

	base := *c.cwd
	lookupDir := dirPart
	if dirPart == "" {
		lookupDir = base
	} else if !filepath.IsAbs(dirPart) {
		lookupDir = filepath.Join(base, dirPart)
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
		// Hide dotfiles unless a leading dot was typed, like zsh/bash.
		if strings.HasPrefix(e.Name(), ".") && !strings.HasPrefix(filePart, ".") {
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
