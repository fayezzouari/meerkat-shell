const term = new Terminal({
  fontFamily: "Menlo, Consolas, monospace",
  fontSize: 14,
  theme: { background: "#1e1e1e" },
  cursorBlink: true,
});
term.open(document.getElementById("terminal"));
term.writeln("Meerkat — connecting...");

let cwd = "~";
let currentLine = "";
let cursorPos = 0;
let bannerSeen = false;

function prompt() {
  term.write(`\r\n\x1b[36mmeerkat\x1b[0m \x1b[33m${cwd}\x1b[0m> `);
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
    prompt();
  }
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
  })
  .catch((err) => {
    term.writeln(`\r\n\x1b[31mConnection error: ${err}\x1b[0m`);
  });

// The daemon has no pty, so there's no kernel tty driver doing local
// echo/cursor-editing for us — we fake "cooked mode" here, including
// mid-line cursor movement, word jumps, and Tab completion. This is a
// deliberate simplification, not a missing feature — see meerkat-daemon's
// README for the pty/erlexec phase that would let real curses programs
// (vim, htop, less) work, at which point raw bytes could be forwarded on
// every keystroke instead.

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
  if (data === "\r") {
    window.go.main.App.SendLine(currentLine);
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
    // Other control chars (Ctrl+C, Ctrl+D, ...) — real handling arrives
    // with job control.
    return;
  }
  insertText(data);
});
