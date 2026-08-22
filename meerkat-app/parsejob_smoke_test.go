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

// The full line an up-to-date daemon sends, and the shorter ones an older one
// would: everything past the command is optional.
func TestParseJobLinePortsAndDetached(t *testing.T) {
	job, ok := parseJobLine("[2] running\tpython3 -m http.server\t4711\t8000,8001\tdetached")
	if !ok {
		t.Fatal("full line did not parse")
	}
	if job.Id != 2 || job.Status != "running" || job.Cmd != "python3 -m http.server" {
		t.Fatalf("got %+v", job)
	}
	if job.osPid != 4711 || !job.hasOsPid {
		t.Fatalf("os pid: got %d hasOsPid=%v", job.osPid, job.hasOsPid)
	}
	if len(job.Ports) != 2 || job.Ports[0] != 8000 || job.Ports[1] != 8001 {
		t.Fatalf("ports: got %v", job.Ports)
	}
	if !job.Detached {
		t.Fatal("detached flag was not read")
	}

	// A job that is listening but still has its pane.
	job, _ = parseJobLine("[3] running\tnpm run dev\t4712\t3000\t")
	if len(job.Ports) != 1 || job.Ports[0] != 3000 {
		t.Fatalf("single port: got %v", job.Ports)
	}
	if job.Detached {
		t.Fatal("empty flag field should not read as detached")
	}

	// Listening on nothing: nil, not an empty slice — the frontend tests one
	// shape for "no ports".
	job, _ = parseJobLine("[4] running\tsleep 30\t4713\t\t")
	if job.Ports != nil {
		t.Fatalf("no ports: got %v, want nil", job.Ports)
	}

	// Verbatim from a live daemon: the command comes back shell-quoted, one
	// quoted word per argument, which must not be mistaken for extra fields.
	job, ok = parseJobLine("[1] running\t'python3' '-m' 'http.server' '8123'\t57885\t8123\tdetached")
	if !ok || job.Cmd != "'python3' '-m' 'http.server' '8123'" {
		t.Fatalf("live line: cmd = %q ok=%v", job.Cmd, ok)
	}
	if len(job.Ports) != 1 || job.Ports[0] != 8123 || !job.Detached || job.osPid != 57885 {
		t.Fatalf("live line: got %+v", job)
	}

	// Older daemons.
	job, ok = parseJobLine("[5] running\tsleep 30\t4714")
	if !ok || job.osPid != 4714 || job.Ports != nil || job.Detached {
		t.Fatalf("os-pid-only line: got %+v ok=%v", job, ok)
	}
	job, ok = parseJobLine("[6] running\tsleep 30")
	if !ok || job.hasOsPid || job.Ports != nil || job.Detached {
		t.Fatalf("command-only line: got %+v ok=%v", job, ok)
	}
}
