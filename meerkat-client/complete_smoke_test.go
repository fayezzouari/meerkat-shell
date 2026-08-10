package main

import (
	"os"
	"testing"
)

func TestPathCompleterCommand(t *testing.T) {
	dir := t.TempDir()
	cwd := dir
	c := &pathCompleter{cwd: &cwd}
	line := []rune("cd")
	nl, length := c.Do(line, len(line))
	t.Logf("length=%d", length)
	for _, r := range nl {
		t.Logf("cand=%q", string(r))
	}
	if len(nl) == 0 {
		t.Fatal("expected command candidates for prefix 'cd'")
	}
}

func TestPathCompleterFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(dir+"/projects", 0755); err != nil {
		t.Fatal(err)
	}
	cwd := dir
	c := &pathCompleter{cwd: &cwd}
	line := []rune("cd proj")
	nl, length := c.Do(line, len(line))
	t.Logf("length=%d", length)
	for _, r := range nl {
		t.Logf("cand=%q", string(r))
	}
	if len(nl) != 1 || string(nl[0]) != "ects/" {
		t.Fatalf("expected completion 'ects/', got %v", nl)
	}
}
