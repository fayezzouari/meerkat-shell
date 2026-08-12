// The one place that knows about window.go / window.runtime. Wails events are
// global no matter how many Go-side sessions exist, so each carries its
// session id and this module routes it to that session's callbacks.
const sessionCallbacks = new Map(); // id -> { onLine, onPty, onClosed }
let listenersRegistered = false;

function ensureListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  window.runtime.EventsOn("daemon:line", ({ id, line }) => {
    sessionCallbacks.get(id)?.onLine(line);
  });

  // Base64 on the wire because pty output is arbitrary subprocess bytes,
  // not guaranteed UTF-8. term.write accepts the decoded bytes directly.
  window.runtime.EventsOn("daemon:pty", ({ id, data }) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    sessionCallbacks.get(id)?.onPty(bytes);
  });

  window.runtime.EventsOn("daemon:closed", ({ id }) => {
    sessionCallbacks.get(id)?.onClosed();
  });
}

// Listeners must be registered before NewSession() resolves: Wails events
// aren't buffered, so anything emitted first is lost. Resolves to {id, cwd}.
export async function openSession({ onLine, onPty, onClosed }) {
  ensureListeners();
  const info = await window.go.main.App.NewSession();
  sessionCallbacks.set(info.id, { onLine, onPty, onClosed });
  return info;
}

export function closeSession(id) {
  sessionCallbacks.delete(id);
  return window.go.main.App.CloseSession(id);
}

export function sendLine(id, line) {
  return window.go.main.App.SendLine(id, line);
}

export function sendInput(id, data) {
  return window.go.main.App.SendInput(id, data);
}

export function sendResize(id, rows, cols) {
  return window.go.main.App.SendResize(id, rows, cols);
}

export function killJob(id) {
  return window.go.main.App.KillJob(id);
}

// Jobs are daemon-wide, not per-session.
export function listJobs() {
  return window.go.main.App.ListJobs();
}
