import { terminalOptions } from "./js/theme.js";
import { createLineEditor } from "./js/lineEditor.js";
import { createCompletionMenu } from "./js/completion.js";
import { createHistory } from "./js/history.js";
import * as daemon from "./js/daemonClient.js";
import { locationFor } from "./js/promptInfo.js";

const term = new Terminal(terminalOptions);
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal"));
fitAddon.fit();
term.writeln("Meerkat — connecting...");

// FitAddon measures cell size from whatever font is actually rendering
// right now — if JetBrains Mono (a webfont, loaded via index.html's
// Google Fonts link) is still downloading, that first fit() above
// measures the fallback font's (different) character width instead, and
// the wrong cols/rows is what gets reported to the daemon below. Once the
// real font swaps in with no corresponding re-fit, every pty'd program
// (ls's column layout, vim/htop's full-screen redraws, plain line
// wrapping) sizes itself against a terminal width that no longer matches
// what's actually on screen. document.fonts.ready resolves once every
// @font-face referenced in the document has finished loading, so this
// re-fits and re-sends the corrected size — sendResize() again below is a
// safe no-op-ish call (just resends the current, now-accurate, size).
document.fonts.ready.then(() => {
  fitAddon.fit();
  sendResize();
});

const editor = createLineEditor(term);
const completion = createCompletionMenu(term, editor);
const history = createHistory();

let cwd = "~";

// Whether a foreground job is currently running (i.e. an "X:" is still
// outstanding for the last line we sent). While true, keystrokes go raw
// to the job's pty via SendInput instead of the local line editor —
// the pty (with pty_echo on, see meerkat-daemon's evaluator.ex) is what
// echoes them back, exactly like a real terminal.
let jobRunning = false;

// Prompt shows "<repo> <branch>" (colored) inside a git working tree, or
// the "~"-shortened cwd otherwise — see promptInfo.js. Then a plain white
// arrow, then switches to bright white (left active, no trailing reset)
// so everything typed next — the command itself — reads white against the
// grey/colored output around it. \x1b[0m up front guards against a
// program leaving the terminal mid-SGR-state on exit.
async function prompt() {
  const location = await locationFor(cwd);
  term.write(`\x1b[0m\r\n${location} \x1b[97m❯\x1b[0m \x1b[97m`);
}

function sendResize() {
  daemon.sendResize(term.rows, term.cols);
}

// Every raw daemon protocol line arrives here. This is the one place
// that knows about "O:"/"E:"/"D:"/"X:" — if the protocol grows (job
// control events, etc.) this is where new prefixes get handled.
daemon
  .connectDaemon({
    onLine: (raw) => {
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
    },
    onPty: (bytes) => term.write(bytes),
    onClosed: () => term.writeln("\r\n\x1b[90m[daemon connection closed]\x1b[0m"),
  })
  .then((initialCwd) => {
    cwd = initialCwd || "~";
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

// Handles a full escape sequence delivered as one onData chunk (xterm.js
// hands us the whole thing per keypress, not byte-by-byte).
function handleEscape(data) {
  switch (data) {
    case "\x1b[D":
      editor.moveCursor(-1);
      return;
    case "\x1b[C":
      editor.moveCursor(1);
      return;
    // Option+Left: iTerm2/xterm CSI form, or Terminal.app's default meta-b.
    case "\x1b[1;3D":
    case "\x1bb":
      editor.moveCursorTo(editor.wordLeftPos(editor.getCursor()));
      return;
    // Option+Right: iTerm2/xterm CSI form, or Terminal.app's default meta-f.
    case "\x1b[1;3C":
    case "\x1bf":
      editor.moveCursorTo(editor.wordRightPos(editor.getCursor()));
      return;
    // Home / Cmd+Left (once the terminal is configured to send it, e.g.
    // iTerm2's "Natural Text Editing" preset).
    case "\x1b[H":
    case "\x1bOH":
    case "\x1b[1~":
      editor.moveCursorTo(0);
      return;
    // End / Cmd+Right.
    case "\x1b[F":
    case "\x1bOF":
    case "\x1b[4~":
      editor.moveCursorTo(editor.getLine().length);
      return;
    // Up/Down — browse command history.
    case "\x1b[A":
      history.up(editor);
      return;
    case "\x1b[B":
      history.down(editor);
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
    daemon.sendInput(data);
    return;
  }

  // Menu nav (Tab/Shift+Tab/Left/Right) while a completion menu is open
  // is consumed here; anything else falls through to normal handling
  // below, whether or not a menu was open (see completion.js).
  if (completion.handleKey(data)) return;

  if (data === "\r") {
    // Move to a fresh line locally the instant Enter is pressed, like a
    // real terminal does — whatever the command prints next (raw pty
    // output, unlike the old O:/E: lines) has no idea where our locally
    // echoed command text left the cursor, and won't send a leading
    // newline of its own. \x1b[0m drops the white "typing" color set by
    // prompt() so results print in the default grey (or their own colors).
    term.write("\x1b[0m\r\n");
    daemon.sendLine(editor.getLine());
    jobRunning = true;
    editor.reset();
    return;
  }
  if (data === "\t") {
    completion.handleTab(cwd);
    return;
  }
  if (data.charCodeAt(0) === 127) {
    editor.backspace();
    return;
  }
  if (data.charCodeAt(0) === 27) {
    handleEscape(data);
    return;
  }
  if (data === "\x01") {
    // Ctrl+A
    editor.moveCursorTo(0);
    return;
  }
  if (data === "\x05") {
    // Ctrl+E
    editor.moveCursorTo(editor.getLine().length);
    return;
  }
  if (data.charCodeAt(0) < 32) {
    // Other control chars while composing a line (Ctrl+C, Ctrl+D, ...) —
    // no running job to send them to, so there's nothing to do with them.
    return;
  }
  editor.insertText(data);
});
