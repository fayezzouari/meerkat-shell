import { terminalOptions } from "./theme.js";
import { createLineEditor } from "./lineEditor.js";
import { createCompletionMenu } from "./completion.js";
import { createHistory } from "./history.js";
import * as daemon from "./daemonClient.js";
import { locationFor } from "./promptInfo.js";

// Creates one tab: its own daemon connection, xterm.js Terminal, and all
// the per-session state (line editor, completion menu, history, cwd,
// whether a job is running) that used to be main.js's module-level state
// before tabs existed. Every tab gets an independent instance of each —
// same behavior as the single-session app, just N times over.
//
// `container` is the <div> this tab's Terminal renders into (sessionManager
// owns creating/showing/hiding these). `initialCwd`, if given, is sent as
// a `cd` right after connecting (new tabs inherit the active tab's cwd —
// see sessionManager.js) rather than always starting at $HOME.
// `onNewTabRequested`/`onToggleOverlayRequested` are called for Ctrl+T /
// Ctrl+M, intercepted here (per-Terminal, see attachCustomKeyEventHandler
// below) and left to sessionManager/jobsOverlay to actually act on, so
// this module doesn't need to know about tabs-plural or the overlay.
// `onSessionEnded` is called whenever the daemon connection closes for any
// reason (typing `exit`/`quit`, the daemon process dying, ...) — same
// "this shell is done" signal a real terminal reacts to by closing the
// tab (or quitting the app, if it was the last one); sessionManager
// decides which.
export async function createSession({
  container,
  initialCwd,
  onNewTabRequested,
  onToggleOverlayRequested,
  onSessionEnded,
}) {
  const term = new Terminal(terminalOptions);
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();
  term.writeln("Meerkat — connecting...");

  const editor = createLineEditor(term);
  const completion = createCompletionMenu(term, editor);
  const history = createHistory();

  let id = null;
  let cwd = "~";

  // Whether a foreground job is currently running (i.e. an "X:" is still
  // outstanding for the last line sent). While true, keystrokes go raw to
  // the job's pty via SendInput instead of the local line editor — the
  // pty (with pty_echo on, see meerkat-daemon's evaluator.ex) is what
  // echoes them back, exactly like a real terminal.
  let jobRunning = false;

  // Prompt shows "<repo> <branch>" (colored) inside a git working tree, or
  // the "~"-shortened cwd otherwise — see promptInfo.js. Then a plain white
  // arrow, then switches to bright white (left active, no trailing reset)
  // so everything typed next — the command itself — reads white against
  // the grey/colored output around it. \x1b[0m up front guards against a
  // program leaving the terminal mid-SGR-state on exit.
  async function prompt() {
    const location = await locationFor(cwd);
    term.write(`\x1b[0m\r\n${location} \x1b[97m❯\x1b[0m \x1b[97m`);
  }

  function sendResize() {
    daemon.sendResize(id, term.rows, term.cols);
  }

  function fit() {
    fitAddon.fit();
    sendResize();
  }

  // FitAddon measures cell size from whatever font is actually rendering
  // right now — if JetBrains Mono (a webfont, loaded via index.html's
  // Google Fonts link) is still downloading, that first fit() above
  // measures the fallback font's (different) character width instead, and
  // the wrong cols/rows is what gets reported to the daemon. Once the real
  // font swaps in with no corresponding re-fit, every pty'd program (ls's
  // column layout, vim/htop's full-screen redraws, plain line wrapping)
  // sizes itself against a terminal width that no longer matches what's
  // actually on screen. document.fonts.ready resolves once every
  // @font-face referenced in the document has finished loading, so this
  // re-fits and re-sends the corrected size.
  document.fonts.ready.then(fit);

  const info = await daemon.openSession({
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
    // No message written here — the tab is about to close (or the whole
    // app is about to quit) either way, same as a real terminal closing a
    // tab the instant its shell process exits, so there's nothing useful
    // to show first.
    onClosed: () => onSessionEnded(id),
  });
  id = info.id;
  cwd = info.cwd || "~";
  term.reset();
  // `id` is only just now valid — do this here rather than relying solely
  // on the document.fonts.ready handler above, which can fire (with `id`
  // still null) before this async function even gets this far if fonts
  // were already cached from an earlier tab; that handler only ever fires
  // once, so a too-early call there would otherwise never get corrected.
  fit();

  if (initialCwd && initialCwd !== cwd) {
    // Silent — the new tab shouldn't show a "cd" line in its own fresh
    // scrollback, it should just already be there when the prompt appears.
    // prompt() runs once the "X:" for this comes back through onLine,
    // same as any other command completing. Quoted: meerkat's parser
    // tokenizes on whitespace with no path-aware special-casing, so an
    // unquoted cwd containing a space (e.g. "My Documents") would get
    // split into multiple args and `cd` (which only looks at the first
    // one) would land somewhere wrong or nonexistent.
    jobRunning = true;
    daemon.sendLine(id, `cd "${initialCwd.replace(/"/g, '\\"')}"`);
  } else {
    prompt();
  }

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
      // A program is running and owns the pty now — forward every
      // keystroke raw, including control bytes (Ctrl+C, Ctrl+Z, ...),
      // exactly like a real terminal would. The pty's own line discipline
      // / the program itself interprets them; no local editing applies.
      daemon.sendInput(id, data);
      return;
    }

    // Menu nav (Tab/Shift+Tab/Left/Right) while a completion menu is open
    // is consumed here; anything else falls through to normal handling
    // below, whether or not a menu was open (see completion.js).
    if (completion.handleKey(data)) return;

    if (data === "\r") {
      // Move to a fresh line locally the instant Enter is pressed, like a
      // real terminal does — whatever the command prints next (raw pty
      // output) has no idea where our locally echoed command text left
      // the cursor, and won't send a leading newline of its own. \x1b[0m
      // drops the white "typing" color set by prompt() so results print
      // in the default grey (or their own colors).
      term.write("\x1b[0m\r\n");
      history.record(editor.getLine());
      daemon.sendLine(id, editor.getLine());
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

  // Intercepts a handful of combos before xterm.js converts them to bytes
  // — needed rather than checking in onData for two different reasons:
  //
  // - Cmd+M is ASCII 0x0D, identical to Enter/"\r", so without catching
  //   the raw KeyboardEvent here (which still distinguishes metaKey+
  //   key:"m" from a plain Enter press) a physical Cmd+M would otherwise
  //   just submit the current line instead of opening the overlay.
  // - Cmd+Left/Right and Option+Left/Right aren't reliably turned into a
  //   distinguishable escape sequence by xterm.js's default keymap at
  //   all (unlike Ctrl combos), so there's nothing for onData/handleEscape
  //   to reliably key off of — reading event.metaKey/altKey/key directly
  //   is the only robust way to catch them.
  //
  // Returning false tells xterm.js to swallow the event entirely — it
  // never reaches onData. Line-editing shortcuts (word/line jumps) only
  // apply while composing a command with no completion menu open — while
  // a job is running the pty owns keystrokes (real programs may want
  // Option+Arrow themselves), and jumping the cursor while a completion
  // menu is displayed would leave it open but stale.
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;

    if (event.metaKey && !event.ctrlKey && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "t") {
        event.preventDefault();
        onNewTabRequested();
        return false;
      }
      if (key === "m") {
        event.preventDefault();
        onToggleOverlayRequested();
        return false;
      }
      if (!jobRunning && !completion.isActive()) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          editor.moveCursorTo(0);
          return false;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          editor.moveCursorTo(editor.getLine().length);
          return false;
        }
      }
    }

    if (event.altKey && !event.metaKey && !event.ctrlKey && !jobRunning && !completion.isActive()) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        editor.moveCursorTo(editor.wordLeftPos(editor.getCursor()));
        return false;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        editor.moveCursorTo(editor.wordRightPos(editor.getCursor()));
        return false;
      }
    }

    return true;
  });

  return {
    id,
    getCwd: () => cwd,
    fit,
    focus: () => term.focus(),
    dispose: () => {
      daemon.closeSession(id);
      term.dispose();
    },
  };
}
