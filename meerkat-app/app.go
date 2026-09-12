package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"meerkat-app/daemonclient"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is bound to the frontend: every exported method is callable from JS as
// window.go.main.App.<MethodName>(...). One daemon connection per tab, keyed
// by a session id the frontend uses to route requests and events.
type App struct {
	ctx context.Context

	mu       sync.Mutex
	sessions map[string]*daemonclient.Client
	nextID   int
	daemonUp bool // true once any NewSession call has connected
}

func NewApp() *App {
	return &App{sessions: make(map[string]*daemonclient.Client)}
}

// startup does NOT open a session — the frontend calls NewSession once its
// event listeners are registered, since Wails events aren't buffered.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// See main.go's WindowStartState comment: launching fullscreen is what
	// grants the window native-fullscreen capability; this drops straight
	// back to windowed while keeping it.
	runtime.WindowUnfullscreen(ctx)

	// A copy that carries its own engine came from a .dmg or from the
	// installer, not from a checkout — so it is the kind of copy that should
	// offer to wire up the command line. In a dev build there is no bundled
	// engine and this does nothing, which is what you want while working.
	//
	// On its own goroutine: MessageDialog is modal, and blocking startup means
	// blocking the window that dialog is supposed to appear over.
	if engine := bundledEngine(); engine != "" {
		go a.offerCLIInstall(engine)
	}
}

type SessionInfo struct {
	Id  string `json:"id"`
	Cwd string `json:"cwd"`
}

// NewSession opens a daemon connection for one tab.
func (a *App) NewSession() (SessionInfo, error) {
	a.mu.Lock()
	spawnIfMissing := !a.daemonUp
	a.mu.Unlock()

	var client *daemonclient.Client
	var err error
	if spawnIfMissing {
		client, err = daemonclient.Connect()
	} else {
		client, err = daemonclient.ConnectExisting()
	}
	if err != nil {
		return SessionInfo{}, err
	}

	cwd := ""
	if msgType, payload, ok := client.ReadFrame(); ok && msgType == daemonclient.MsgCwd {
		cwd = string(payload)
	}

	a.mu.Lock()
	a.nextID++
	id := fmt.Sprintf("s%d", a.nextID)
	a.sessions[id] = client
	a.daemonUp = true
	a.mu.Unlock()

	go a.readLoop(id, client)
	return SessionInfo{Id: id, Cwd: cwd}, nil
}

func (a *App) CloseSession(id string) string {
	a.mu.Lock()
	client, ok := a.sessions[id]
	delete(a.sessions, id)
	a.mu.Unlock()

	if !ok {
		return "no such session"
	}
	if err := client.Close(); err != nil {
		return err.Error()
	}
	return ""
}

func (a *App) client(id string) *daemonclient.Client {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sessions[id]
}

// readLoop forwards every daemon frame to the frontend, tagged with the
// session id. Pty output gets its own base64-encoded event: it's arbitrary
// subprocess bytes and can split a multi-byte UTF-8 character across chunks,
// so it isn't safe to pass as a JS string.
func (a *App) readLoop(id string, client *daemonclient.Client) {
	for {
		msgType, payload, ok := client.ReadFrame()
		if !ok {
			runtime.EventsEmit(a.ctx, "daemon:closed", map[string]string{"id": id})
			return
		}

		switch msgType {
		case daemonclient.MsgPty:
			runtime.EventsEmit(a.ctx, "daemon:pty", map[string]string{
				"id":   id,
				"data": base64.StdEncoding.EncodeToString(payload),
			})
		case daemonclient.MsgStdout:
			runtime.EventsEmit(a.ctx, "daemon:line", map[string]string{"id": id, "line": "O:" + string(payload)})
		case daemonclient.MsgStderr:
			runtime.EventsEmit(a.ctx, "daemon:line", map[string]string{"id": id, "line": "E:" + string(payload)})
		case daemonclient.MsgCwd:
			runtime.EventsEmit(a.ctx, "daemon:line", map[string]string{"id": id, "line": "D:" + string(payload)})
		case daemonclient.MsgHello:
			runtime.EventsEmit(a.ctx, "daemon:engine", map[string]any{
				"id":     id,
				"engine": daemonclient.ParseIdentity(string(payload)),
			})
		case daemonclient.MsgExit:
			runtime.EventsEmit(a.ctx, "daemon:line", map[string]string{"id": id, "line": "X:" + string(payload)})
		}
	}
}

func (a *App) SendLine(id string, line string) string {
	client := a.client(id)
	if client == nil {
		return "not connected to daemon"
	}
	if err := client.SendLine(line); err != nil {
		return err.Error()
	}
	return ""
}

// SendInput forwards a keystroke raw to the running job's pty stdin.
func (a *App) SendInput(id string, data string) string {
	client := a.client(id)
	if client == nil {
		return "not connected to daemon"
	}
	if err := client.SendInput([]byte(data)); err != nil {
		return err.Error()
	}
	return ""
}

func (a *App) KillJob(id string) string {
	client := a.client(id)
	if client == nil {
		return "not connected to daemon"
	}
	if err := client.Kill(); err != nil {
		return err.Error()
	}
	return ""
}

// KillJobById kills a job by its id in the daemon's job table, over a
// connection of its own.
//
// KillJob above is a different thing despite the name: it sends "K" down one
// pane's socket, which the daemon reads as "whatever is in the foreground of
// this connection". The sidebar needs neither of those — the job it offers to
// kill may be one whose pane is already closed, which is precisely when it is
// the only way to end it.
func (a *App) KillJobById(jobId int) string {
	client, err := daemonclient.ConnectExisting()
	if err != nil {
		return err.Error()
	}
	defer client.Close()

	client.ReadFrame() // discard the initial "D:<cwd>" banner

	if err := client.SendLine(fmt.Sprintf("kill %d", jobId)); err != nil {
		return err.Error()
	}

	// Read to the "X" so the caller's refresh sees a table that has already
	// changed, and so a refusal ("[7] has no live handle") is reported rather
	// than silently dropped.
	for {
		msgType, payload, ok := client.ReadFrame()
		if !ok {
			return ""
		}
		switch msgType {
		case daemonclient.MsgStderr:
			return string(payload)
		case daemonclient.MsgExit:
			return ""
		}
	}
}

func (a *App) SendResize(id string, rows int, cols int) string {
	client := a.client(id)
	if client == nil {
		return "not connected to daemon"
	}
	if err := client.SendResize(uint16(rows), uint16(cols)); err != nil {
		return err.Error()
	}
	return ""
}

// JobInfo is one row of `jobs` output, structured for the jobs overlay.
//
// Ports and Detached come from the daemon, which is where a listening socket is
// looked up (MeerkatDaemon.Ports) — it needs the answer itself, to decide
// whether a job outlives the pane that started it. Memory is measured here
// instead: nothing in the daemon acts on it.
type JobInfo struct {
	Id       int    `json:"id"`
	Status   string `json:"status"`
	Cmd      string `json:"cmd"`
	ExitCode *int   `json:"exitCode"`
	MemoryKB *int   `json:"memoryKB"`
	Ports    []int  `json:"ports"`
	Detached bool   `json:"detached"`
	osPid    int
	hasOsPid bool
}

// EngineInfo is what the sidebar shows next to the job table: which engine
// this app is talking to. Two can exist at once — the installed release and a
// checkout's `mix run` — and they are told apart by the instance id, the
// flavor and the socket, none of which the terminal's prompt shows.
type EngineInfo struct {
	daemonclient.Identity
	Reachable bool   `json:"reachable"`
	Expected  string `json:"expected"` // the socket this app dials
}

func (a *App) EngineInfo() EngineInfo {
	path := daemonclient.SocketPath()
	id, err := daemonclient.Probe(path)
	if err != nil {
		return EngineInfo{Expected: path}
	}
	if id.Socket == "" {
		id.Socket = path
	}
	return EngineInfo{Identity: id, Reachable: true, Expected: path}
}

// ListJobs reports the daemon-wide `jobs` table (JobManager is one GenServer,
// not per-connection). Uses its own short-lived connection so running it
// doesn't dump "jobs" into a visible tab's scrollback.
func (a *App) ListJobs() ([]JobInfo, error) {
	client, err := daemonclient.ConnectExisting()
	if err != nil {
		return nil, err
	}
	defer client.Close()

	client.ReadFrame() // discard the initial "D:<cwd>" banner

	if err := client.SendLine("jobs"); err != nil {
		return nil, err
	}

	var jobs []JobInfo
	for {
		msgType, payload, ok := client.ReadFrame()
		if !ok || msgType == daemonclient.MsgExit {
			break
		}
		if msgType == daemonclient.MsgStdout {
			if job, ok := parseJobLine(string(payload)); ok {
				// A "done" job's os_pid no longer refers to anything.
				if job.hasOsPid && (job.Status == "running" || job.Status == "stopped") {
					if kb, ok := processTreeRSSKB(job.osPid); ok {
						job.MemoryKB = &kb
					}
				}
				jobs = append(jobs, job)
			}
		}
	}
	return jobs, nil
}

// parseJobLine parses one line of the `jobs` builtin's output:
//
//	"[<id>] <status>[ (exit <code>)]\t<cmd>\t<os_pid>\t<ports>\t<flags>"
//
// See evaluator.ex. Every field after the command is optional, so an older
// daemon — one that stops at the os_pid, or at the command — still parses; the
// fields it didn't send simply come back zero.
func parseJobLine(line string) (JobInfo, bool) {
	if !strings.HasPrefix(line, "[") {
		return JobInfo{}, false
	}
	closeBracket := strings.Index(line, "]")
	if closeBracket < 0 {
		return JobInfo{}, false
	}
	id, err := strconv.Atoi(line[1:closeBracket])
	if err != nil {
		return JobInfo{}, false
	}

	rest := strings.TrimPrefix(line[closeBracket+1:], " ")
	firstTab := strings.IndexByte(rest, '\t')
	if firstTab < 0 {
		return JobInfo{}, false
	}
	status := rest[:firstTab]

	fields := strings.Split(rest[firstTab+1:], "\t")
	job := JobInfo{Id: id, Status: status, Cmd: fields[0]}

	if len(fields) > 1 {
		if p, err := strconv.Atoi(fields[1]); err == nil {
			job.osPid, job.hasOsPid = p, true
		}
	}
	if len(fields) > 2 {
		job.Ports = parsePortList(fields[2])
	}
	if len(fields) > 3 {
		job.Detached = fields[3] == "detached"
	}

	if i := strings.Index(status, " (exit "); i >= 0 {
		codeStr := strings.TrimSuffix(status[i+len(" (exit "):], ")")
		if code, err := strconv.Atoi(codeStr); err == nil {
			job.ExitCode = &code
		}
		job.Status = status[:i]
	}

	return job, true
}

// parsePortList reads the daemon's comma-separated port field. Returns nil for
// an empty field so the frontend gets `null` rather than `[]` — one shape for
// "no ports", whichever daemon answered.
func parsePortList(field string) []int {
	if field == "" {
		return nil
	}
	var ports []int
	for _, part := range strings.Split(field, ",") {
		if port, err := strconv.Atoi(part); err == nil {
			ports = append(ports, port)
		}
	}
	return ports
}

// processTreeRSSKB sums RSS (in KB) for osPid and every descendant. Walks the
// pid/ppid tree rather than the process group, because erlexec puts every job
// it spawns in the port driver's single group — a group query would sum all
// running jobs together.
func processTreeRSSKB(osPid int) (int, bool) {
	out, err := exec.Command("ps", "-axo", "pid,ppid,rss").Output()
	if err != nil {
		return 0, false
	}

	type proc struct{ ppid, rss int }
	procs := make(map[int]proc)
	children := make(map[int][]int)

	lines := strings.Split(string(out), "\n")
	for _, line := range lines[1:] { // skip the header row
		fields := strings.Fields(line)
		if len(fields) != 3 {
			continue
		}
		pid, err1 := strconv.Atoi(fields[0])
		ppid, err2 := strconv.Atoi(fields[1])
		rss, err3 := strconv.Atoi(fields[2])
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		procs[pid] = proc{ppid: ppid, rss: rss}
		children[ppid] = append(children[ppid], pid)
	}

	if _, ok := procs[osPid]; !ok {
		return 0, false
	}

	total := 0
	var visit func(pid int)
	visit = func(pid int) {
		total += procs[pid].rss
		for _, child := range children[pid] {
			visit(child)
		}
	}
	visit(osPid)
	return total, true
}

func (a *App) shutdown(_ context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, client := range a.sessions {
		client.Close()
	}
}

// The background image is stored by path in localStorage (base64 bytes would
// blow the ~5MB quota) and re-read into a data URI on each launch, so a moved
// or deleted file surfaces as an error from BackgroundImage.

// The encoded string is ~4/3 the file size and is held in memory by both Go
// and the webview, so an unbounded read here would wedge the app.
const maxBackgroundImageBytes = 16 << 20 // 16 MiB

// PickBackgroundImage returns the chosen path, or "" if cancelled.
func (a *App) PickBackgroundImage() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose a background image",
		Filters: []runtime.FileFilter{{
			DisplayName: "Images (*.png, *.jpg, *.jpeg, *.gif, *.webp)",
			Pattern:     "*.png;*.jpg;*.jpeg;*.gif;*.webp",
		}},
	})
}

// BackgroundImage returns `path` as a data: URI for use in a CSS url(). A
// data URI rather than file://, because the webview serves the app from
// Wails' asset server and won't load arbitrary local files.
func (a *App) BackgroundImage(path string) (string, error) {
	if path == "" {
		return "", nil
	}

	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("cannot read background image: %w", err)
	}
	if info.Size() > maxBackgroundImageBytes {
		return "", fmt.Errorf("background image is %d MB; the limit is %d MB",
			info.Size()>>20, maxBackgroundImageBytes>>20)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("cannot read background image: %w", err)
	}

	// Sniffed rather than trusted from the extension: a mislabelled file
	// produces a data URI the webview silently refuses to render.
	mime := http.DetectContentType(data)
	if !strings.HasPrefix(mime, "image/") {
		return "", fmt.Errorf("%s is not an image (detected %s)", filepath.Base(path), mime)
	}

	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}
