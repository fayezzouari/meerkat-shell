const term = new Terminal({
  fontFamily: "Menlo, Consolas, monospace",
  fontSize: 14,
  theme: { background: "#1e1e1e" },
  cursorBlink: true,
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal"));
fitAddon.fit();
term.writeln("Meerkat — connecting...");

let cwd = "~";
let currentLine = "";
let cursorPos = 0;
let bannerSeen = false;

// Whether a foreground job is currently running (i.e. an "X:" is still
// outstanding for the last line we sent). While true, keystrokes go raw
// to the job's pty via SendInput instead of the local line editor below —
// the pty (with pty_echo on, see meerkat-daemon's evaluator.ex) is what
// echoes them back, exactly like a real terminal.
let jobRunning = false;

function prompt() {
  term.write(`\r\n\x1b[36mmeerkat\x1b[0m \x1b[33m${cwd}\x1b[0m> `);
}

function sendResize() {
  window.go.main.App.SendResize(term.rows, term.cols);
}

// Every raw daemon protocol line arrives here. This is the one place
// that knows about "O:"/"E:"/"D:"/"X:" — if the protocol grows (job
// control events, etc.) this is where new prefixes get handled.
window.runtime.EventsOn("daemon:line", (raw) => {
  if (raw.startsWith("O:")) {
    term.write("\r\n" + raw.slice(2));
  } else if (raw.startsWith("E:")) {
    term.write(`\r\n\x1b[31m${raw.slice(2)}\x1b[0m`);
  } else if (raw.startsWith("D:")) {
    cwd = raw.slice(2);
  } else if (raw.startsWith("X:")) {
    jobRunning = false;
    prompt();
  }
});

// Raw pty output for the currently-running foreground job — base64-encoded
// on the Go side since it's arbitrary subprocess bytes, not guaranteed
// valid UTF-8 text. term.write accepts a Uint8Array directly, so decoding
// to bytes (rather than a JS string) sidesteps any encoding assumptions.
window.runtime.EventsOn("daemon:pty", (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  term.write(bytes);
});

window.runtime.EventsOn("daemon:closed", () => {
  term.writeln("\r\n\x1b[90m[daemon connection closed]\x1b[0m");
});

// Listeners above are live now, so it's safe to connect — see Connect's
// doc comment in app.go for why this isn't done eagerly from Go's startup.
window.go.main.App.Connect()
  .then((initialCwd) => {
    cwd = initialCwd || "~";
    bannerSeen = true;
    term.reset();
    prompt();
    sendResize();
  })
  .catch((err) => {
    term.writeln(`\r\n\x1b[31mConnection error: ${err}\x1b[0m`);
  });

window.addEventListener("resize", () => {
  fitAddon.fit();
  sendResize();
});

// Command lines are still composed locally (echo, backspace, cursor
// movement, tab completion) — the daemon never sees any of it until Enter
// sends the full line. Once a job is running, none of this local editing
// applies: see the `jobRunning` branch in term.onData below, which instead
// forwards every keystroke raw to the job's pty.

function insertText(text) {
  const after = currentLine.slice(cursorPos);
  currentLine = currentLine.slice(0, cursorPos) + text + after;
  term.write(text + after);
  if (after.length > 0) term.write(`\x1b[${after.length}D`);
  cursorPos += text.length;
}

function backspace() {
  if (cursorPos === 0) return;
  const after = currentLine.slice(cursorPos);
  currentLine = currentLine.slice(0, cursorPos - 1) + after;
  cursorPos -= 1;
  term.write("\b" + after + " ");
  term.write(`\x1b[${after.length + 1}D`);
}

function moveCursor(delta) {
  const newPos = Math.max(0, Math.min(currentLine.length, cursorPos + delta));
  const diff = newPos - cursorPos;
  if (diff === 0) return;
  term.write(diff > 0 ? `\x1b[${diff}C` : `\x1b[${-diff}D`);
  cursorPos = newPos;
}

function moveCursorTo(pos) {
  moveCursor(pos - cursorPos);
}

function isWordChar(ch) {
  return ch !== undefined && ch !== " ";
}

function wordLeftPos(pos) {
  let i = pos;
  while (i > 0 && !isWordChar(currentLine[i - 1])) i--;
  while (i > 0 && isWordChar(currentLine[i - 1])) i--;
  return i;
}

function wordRightPos(pos) {
  let i = pos;
  const n = currentLine.length;
  while (i < n && !isWordChar(currentLine[i])) i++;
  while (i < n && isWordChar(currentLine[i])) i++;
  return i;
}

function longestCommonPrefix(strs) {
  if (strs.length === 0) return "";
  let p = strs[0];
  for (let i = 1; i < strs.length && p !== ""; i++) {
    while (!strs[i].startsWith(p)) p = p.slice(0, -1);
  }
  return p;
}

async function handleTab() {
  const before = currentLine.slice(0, cursorPos);
  const wordStart = before.lastIndexOf(" ") + 1;
  const word = before.slice(wordStart);
  const isCommand = wordStart === 0;

  let candidates;
  try {
    candidates = await window.go.main.App.Complete(word, cwd, isCommand);
  } catch (e) {
    return;
  }
  if (!candidates || candidates.length === 0) return;

  if (candidates.length === 1) {
    const suffix = candidates[0].slice(word.length);
    if (suffix.length > 0) insertText(suffix);
    return;
  }

  const commonPrefix = longestCommonPrefix(candidates);
  const suffix = commonPrefix.slice(word.length);
  if (suffix.length > 0) insertText(suffix);

  term.write("\r\n" + candidates.join("  "));
  prompt();
  term.write(currentLine);
  if (currentLine.length > cursorPos) {
    term.write(`\x1b[${currentLine.length - cursorPos}D`);
  }
}

// Handles a full escape sequence delivered as one onData chunk (xterm.js
// hands us the whole thing per keypress, not byte-by-byte).
function handleEscape(data) {
  switch (data) {
    case "\x1b[D":
      moveCursor(-1);
      return;
    case "\x1b[C":
      moveCursor(1);
      return;
    // Option+Left: iTerm2/xterm CSI form, or Terminal.app's default meta-b.
    case "\x1b[1;3D":
    case "\x1bb":
      moveCursorTo(wordLeftPos(cursorPos));
      return;
    // Option+Right: iTerm2/xterm CSI form, or Terminal.app's default meta-f.
    case "\x1b[1;3C":
    case "\x1bf":
      moveCursorTo(wordRightPos(cursorPos));
      return;
    // Home / Cmd+Left (once the terminal is configured to send it, e.g.
    // iTerm2's "Natural Text Editing" preset).
    case "\x1b[H":
    case "\x1bOH":
    case "\x1b[1~":
      moveCursorTo(0);
      return;
    // End / Cmd+Right.
    case "\x1b[F":
    case "\x1bOF":
    case "\x1b[4~":
      moveCursorTo(currentLine.length);
      return;
    default:
      return; // unrecognized escape sequence — ignore rather than insert garbage
  }
}

term.onData((data) => {
  if (jobRunning) {
    // A program is running and owns the pty now — forward every keystroke
    // raw, including control bytes (Ctrl+C, Ctrl+Z, ...), exactly like a
    // real terminal would. The pty's own line discipline / the program
    // itself interprets them; no local editing applies here.
    window.go.main.App.SendInput(data);
    return;
  }

  if (data === "\r") {
    // Move to a fresh line locally the instant Enter is pressed, like a
    // real terminal does — whatever the command prints next (raw pty
    // output, unlike the old O:/E: lines) has no idea where our locally
    // echoed command text left the cursor, and won't send a leading
    // newline of its own.
    term.write("\r\n");
    window.go.main.App.SendLine(currentLine);
    jobRunning = true;
    currentLine = "";
    cursorPos = 0;
    return;
  }
  if (data === "\t") {
    handleTab();
    return;
  }
  if (data.charCodeAt(0) === 127) {
    backspace();
    return;
  }
  if (data.charCodeAt(0) === 27) {
    handleEscape(data);
    return;
  }
  if (data === "\x01") {
    // Ctrl+A
    moveCursorTo(0);
    return;
  }
  if (data === "\x05") {
    // Ctrl+E
    moveCursorTo(currentLine.length);
    return;
  }
  if (data.charCodeAt(0) < 32) {
    // Other control chars while composing a line (Ctrl+C, Ctrl+D, ...) —
    // no running job to send them to, so there's nothing to do with them.
    return;
  }
  insertText(data);
});
