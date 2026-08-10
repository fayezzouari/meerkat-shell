package main

import "testing"

func TestParseJobLine(t *testing.T) {
	cases := []struct {
		line    string
		wantOk  bool
		wantID  int
		wantSt  string
		wantCmd string
		wantEC  *int
	}{
		{"[1] running\tsleep 30", true, 1, "running", "sleep 30", nil},
		{"[3] stopped\tvim", true, 3, "stopped", "vim", nil},
		{"no jobs", false, 0, "", "", nil},
	}
	for _, c := range cases {
		job, ok := parseJobLine(c.line)
		if ok != c.wantOk {
			t.Fatalf("%q: ok=%v want %v", c.line, ok, c.wantOk)
		}
		if !ok {
			continue
		}
		if job.Id != c.wantID || job.Status != c.wantSt || job.Cmd != c.wantCmd {
			t.Fatalf("%q: got %+v", c.line, job)
		}
	}

	job, ok := parseJobLine("[2] done (exit 0)\tls -la")
	if !ok || job.Id != 2 || job.Status != "done" || job.Cmd != "ls -la" {
		t.Fatalf("exit-code case: got %+v ok=%v", job, ok)
	}
	if job.ExitCode == nil || *job.ExitCode != 0 {
		t.Fatalf("exit-code case: ExitCode = %v, want 0", job.ExitCode)
	}

	job, ok = parseJobLine("[5] done (exit 130)\tsleep 30")
	if !ok || job.ExitCode == nil || *job.ExitCode != 130 {
		t.Fatalf("nonzero exit-code case: got %+v ok=%v", job, ok)
	}
}
