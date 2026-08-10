// Thin wrapper around the Wails-generated window.go.main.App bindings and
// window.runtime events — the one place that knows about that global
// surface, so the rest of the frontend just calls plain functions.

// Wires up the daemon event listeners and connects. Must be called after
// the listeners it registers are attached (which happens synchronously
// here, before the async Connect() call) — see app.go's Connect doc
// comment for why connecting eagerly from Go's own startup would race
// the frontend's listener registration instead.
export function connectDaemon({ onLine, onPty, onClosed }) {
  window.runtime.EventsOn("daemon:line", onLine);

  // Raw pty output for the currently-running foreground job —
  // base64-encoded on the Go side since it's arbitrary subprocess bytes,
  // not guaranteed valid UTF-8 text. Decoding to a Uint8Array (rather
  // than handing callers a JS string) sidesteps any encoding assumptions;
  // term.write accepts bytes directly.
  window.runtime.EventsOn("daemon:pty", (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    onPty(bytes);
  });

  window.runtime.EventsOn("daemon:closed", onClosed);

  return window.go.main.App.Connect();
}

export function sendLine(line) {
  return window.go.main.App.SendLine(line);
}

export function sendInput(data) {
  return window.go.main.App.SendInput(data);
}

export function sendResize(rows, cols) {
  return window.go.main.App.SendResize(rows, cols);
}
