// Minimal, low-color theme: typed commands are bright white (see the "\r"
// case in term.onData and PROMPT_TAIL below), everything the daemon sends
// back — builtin output, pty output, the prompt's cwd — defaults to a
// muted grey (theme.foreground). Errors stay a desaturated red so they're
// still distinguishable without breaking the otherwise monochrome look.
// Real ANSI colors from programs (ls, vim, ...) still work, just through a
// deliberately desaturated 16-color palette instead of the usual loud
// terminal defaults, to keep those consistent with the rest of the UI.
const term = new Terminal({
  fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
  fontSize: 13,
  fontWeight: 500,
  fontWeightBold: 700,
  cursorStyle: "bar",
  theme: {
    background: "#0b0b0c",
    foreground: "#999999",
    cursor: "#ffffff",
    cursorAccent: "#0b0b0c",
    selectionBackground: "#333333",
    black: "#0b0b0c",
    red: "#b06565",
    green: "#7f9f7f",
    yellow: "#b0a065",
    blue: "#6580b0",
    magenta: "#9a75ad",
    cyan: "#65a0a0",
    white: "#cccccc",
    brightBlack: "#666666",
    brightRed: "#d98a8a",
    brightGreen: "#a3c9a3",
    brightYellow: "#d9c98a",
    brightBlue: "#8aa8d9",
    brightMagenta: "#c2a3d9",
    brightCyan: "#8ac9c9",
    brightWhite: "#ffffff",
  },
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

// Minimal prompt: cwd in the default muted grey, a plain white arrow, then
// switches to bright white (left active, no trailing reset) so everything
// typed next — the command itself — reads white against the grey output
// around it. \x1b[0m up front guards against a program leaving the
// terminal mid-SGR-state on exit.
function prompt() {
  term.write(`\x1b[0m\r\n${cwd} \x1b[97m❯\x1b[0m \x1b[97m`);
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

// Active tab-completion menu, or null. Rather than reprinting the
// candidate list on every Tab press, a second (third, ...) Tab cycles
// `index` through `candidates` and swaps the selected one into the line
// in place — see cycleCompletion/applySelectedCandidate. Left/Right and
// Shift+Tab also cycle it (wired in term.onData).
let completion = null;

async function handleTab() {
  if (completion) {
    cycleCompletion(1);
    return;
  }

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

  // Candidates come back as full tokens (dir prefix included — needed for
  // the suffix math above), but showing "prontooo/x  prontooo/y  ..." is
  // just noise once you're already inside prontooo/ — display only the
  // part past the directory `word` itself is completing within.
  completion = {
    candidates,
    dirLen: word.lastIndexOf("/") + 1,
    wordStart,
    index: -1,
  };
  cycleCompletion(1);
}

// Moves the menu selection by `delta` (wrapping), swaps the newly
// selected candidate into the line, and redraws the list below the
// prompt with the selection highlighted.
function cycleCompletion(delta) {
  const n = completion.candidates.length;
  completion.index = (completion.index + delta + n) % n;
  applySelectedCandidate();
  renderCompletionList();
}

// Replaces the word at completion.wordStart..cursorPos with the selected
// candidate, the same cursor-relative rewrite technique backspace()/
// insertText() use elsewhere in this file — move the terminal cursor back
// to the word's start, erase to end of line, rewrite.
function applySelectedCandidate() {
  const newWord = completion.candidates[completion.index];
  const restAfter = currentLine.slice(cursorPos);

  const back = cursorPos - completion.wordStart;
  if (back > 0) term.write(`\x1b[${back}D`);
  term.write("\x1b[K" + newWord + restAfter);
  if (restAfter.length > 0) term.write(`\x1b[${restAfter.length}D`);

  currentLine = currentLine.slice(0, completion.wordStart) + newWord + restAfter;
  cursorPos = completion.wordStart + newWord.length;
}

// Draws the candidate list on the line below, selected entry in inverse
// video, then returns the cursor to right where it was on the input line.
// \x1b[s/\x1b[u (save/restore cursor) mean this doesn't need to track how
// many terminal rows the list wraps to — the same total text length gets
// written every time (only the inverse-video span moves), so there's
// nothing stale left behind to erase first.
function renderCompletionList() {
  const items = completion.candidates.map((c, i) => {
    const label = c.slice(completion.dirLen);
    return i === completion.index ? `\x1b[7m${label}\x1b[27m` : label;
  });
  term.write("\x1b[s\r\n" + items.join("    ") + "\x1b[u");
}

// Erases the candidate list and drops the menu state — called whenever
// anything other than Tab/Shift+Tab/Left/Right is pressed, confirming
// whatever's currently selected.
function closeCompletionMenu() {
  if (!completion) return;
  term.write("\x1b[s\r\n\x1b[0J\x1b[u");
  completion = null;
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

  if (completion) {
    if (data === "\t") {
      cycleCompletion(1);
      return;
    }
    if (data === "\x1b[Z" || data === "\x1b[D") {
      // Shift+Tab, or Left — move to the previous candidate.
      cycleCompletion(-1);
      return;
    }
    if (data === "\x1b[C") {
      // Right — move to the next candidate.
      cycleCompletion(1);
      return;
    }
    // Anything else confirms the current selection: close the menu, then
    // fall through to handle this keystroke normally (Enter runs the
    // line as-is, typing keeps editing from here, ...).
    closeCompletionMenu();
  }

  if (data === "\r") {
    // Move to a fresh line locally the instant Enter is pressed, like a
    // real terminal does — whatever the command prints next (raw pty
    // output, unlike the old O:/E: lines) has no idea where our locally
    // echoed command text left the cursor, and won't send a leading
    // newline of its own. \x1b[0m drops the white "typing" color set by
    // prompt() so results print in the default grey (or their own colors).
    term.write("\x1b[0m\r\n");
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
