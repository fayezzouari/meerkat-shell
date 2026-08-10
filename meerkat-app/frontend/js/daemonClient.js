// Thin wrapper around the Wails-generated window.go.main.App bindings and
// window.runtime events — the one place that knows about that global
// surface, so the rest of the frontend just calls plain functions.
//
// One daemon connection per open tab (see app.go's per-session App
// methods), but Wails events are global on window.runtime regardless of
// how many Go-side sessions exist — every "daemon:line"/"daemon:pty"/
// "daemon:closed" event carries the originating session's id, and this
// module is what routes each event to that session's own callbacks
// (registered via openSession) rather than every tab hearing every
// other tab's output.
const sessionCallbacks = new Map(); // id -> { onLine, onPty, onClosed }
let listenersRegistered = false;

function ensureListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  window.runtime.EventsOn("daemon:line", ({ id, line }) => {
    sessionCallbacks.get(id)?.onLine(line);
  });

  // Raw pty output for the currently-running foreground job —
  // base64-encoded on the Go side since it's arbitrary subprocess bytes,
  // not guaranteed valid UTF-8 text. Decoding to a Uint8Array (rather
  // than handing callers a JS string) sidesteps any encoding assumptions;
  // term.write accepts bytes directly.
  window.runtime.EventsOn("daemon:pty", ({ id, data }) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    sessionCallbacks.get(id)?.onPty(bytes);
  });

  window.runtime.EventsOn("daemon:closed", ({ id }) => {
    sessionCallbacks.get(id)?.onClosed();
  });
}

// Opens a new tab's daemon connection and registers its event callbacks.
// Must register the listeners (ensureListeners, above) before the async
// NewSession() call resolves — same reasoning as the old single-session
// Connect: an event emitted before anyone is listening for it is just
// lost, since Wails events aren't buffered. Resolves to {id, cwd}.
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

// Jobs are shared across every tab (one JobManager on the daemon side —
// see meerkat_daemon/job_manager.ex), so this isn't scoped to any
// particular session.
export function listJobs() {
  return window.go.main.App.ListJobs();
}
