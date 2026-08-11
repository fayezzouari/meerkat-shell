import { createLineEditor } from "./lineEditor.js";
import { createCompletionMenu } from "./completion.js";
import { createHistory } from "./history.js";
import * as daemon from "./daemonClient.js";
import { locationFor } from "./promptInfo.js";
import * as keymap from "./keymap.js";
import { onAppearanceChange, terminalOptionsFor } from "./appearance.js";

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
// `onNewTabRequested`/`onToggleSidebarRequested`/`onSplitRequested` are
// called for the Cmd+T / Cmd+B / Cmd+D(+Shift) bindings, intercepted here
// (per-Terminal, see attachCustomKeyEventHandler below) and left to
// sessionManager/sidebar to actually act on, so this module doesn't need
// to know about tabs-plural, splits, or the sidebar.
// `onSessionEnded` is called whenever the daemon connection closes for any
// reason (typing `exit`/`quit`, the daemon process dying, ...) — same
// "this shell is done" signal a real terminal reacts to by closing the
// tab (or quitting the app, if it was the last one); sessionManager
// decides which.
export async function createSession({
  container,
  initialCwd,
  onNewTabRequested,
  onToggleSidebarRequested,
  onSplitRequested,
  onSessionEnded,
}) {
  const term = new Terminal(terminalOptionsFor());
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();
  term.writeln("Meerkat — connecting...");

  // Live-apply Preferences changes: color preset, background opacity, and
  // terminal font (see appearance.js, which composes all three).
  //
  // Unlike a pure palette swap, a font change alters the cell size, so the
  // number of rows/cols that fit changes and the pty has to be told —
  // hence the fit() rather than just assigning options. It's skipped
  // before the session id exists, since fit() sends a resize to a
  // connection that isn't established yet.
  const unsubscribeAppearance = onAppearanceChange(() => {
    Object.assign(term.options, terminalOptionsFor());
    if (id !== null) fit();
  });

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

  // True from the moment a job ends until its next prompt is actually on
  // screen. Rendering the prompt is asynchronous (see prompt() below), and
  // during that window the line editor must not accept keystrokes: local
  // echo writes straight to the terminal, so a character typed in that gap
  // would be drawn *before* the prompt it belongs after.
  let awaitingPrompt = false;

  // Serializes every write this module produces that isn't a direct
  // response to a keystroke — pty output, builtin output, and prompts.
  //
  // Without this, prompt() would race: it awaits locationFor() (which is
  // IPC to Go for HomeDir/GitInfo) between the job ending and the prompt
  // text hitting the screen, and any pty bytes still queued behind that
  // job would be written *during* the gap. That's what produced prompts
  // interleaved into a running program's redraw — "~ ❯" landing in the
  // middle of a full-screen TUI's output. Chaining every write means they
  // land in arrival order no matter which of them had to await something.
  let writeChain = Promise.resolve();
  function enqueueWrite(fn) {
    writeChain = writeChain.catch(() => {}).then(fn);
    return writeChain;
  }

  // Prompt shows "<repo> <branch>" (colored) inside a git working tree, or
  // the "~"-shortened cwd otherwise — see promptInfo.js. Then a plain white
  // arrow, then switches to bright white (left active, no trailing reset)
  // so everything typed next — the command itself — reads white against
  // the grey/colored output around it. \x1b[0m up front guards against a
  // program leaving the terminal mid-SGR-state on exit.
  //
  // The location lookup happens *inside* the queued task, so nothing else
  // can write while it's in flight. Returns a promise resolving once the
  // prompt is on screen.
  function prompt() {
    awaitingPrompt = true;
    return enqueueWrite(async () => {
      const location = await locationFor(cwd);
      term.write(`\x1b[0m\r\n${location} \x1b[97m❯\x1b[0m \x1b[97m`);
      awaitingPrompt = false;
    });
  }

  // Only tell the daemon when the grid size actually changed. A pane
  // resize fires continuously while a divider is dragged, but the cell
  // grid only changes at font-cell boundaries — without this, a single
  // drag sends hundreds of identical winsz updates, and every one is a
  // SIGWINCH that makes a full-screen program (vim, htop, claude) throw
  // away its frame and redraw. That storm of half-finished redraws is
  // what leaves debris in the scrollback.
  let lastRows = 0;
  let lastCols = 0;
  function sendResize() {
    if (term.rows === lastRows && term.cols === lastCols) return;
    lastRows = term.rows;
    lastCols = term.cols;
    daemon.sendResize(id, term.rows, term.cols);
  }

  // Skipped while the pane has no size — a tab that's display:none, or a
  // pane mid-relayout. FitAddon would otherwise propose a degenerate
  // rows/cols from the zero-sized parent, and that bogus size would be
  // sent to the daemon and applied to the pty.
  function fit() {
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
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

  // The window-resize listener in sessionManager.js only catches actual
  // window resizes. A macOS fullscreen toggle (green button / Cmd+Ctrl+F)
  // changes the pane's height in steps the resize event doesn't always
  // land on cleanly, and the tab bar growing/shrinking as tabs are added
  // resizes the pane with no window resize at all — in both cases the pty
  // keeps the old row count and the program drawing into it runs off the
  // bottom of the visible area. Observing the container itself catches
  // every one of those, whatever caused it.
  const paneObserver = new ResizeObserver(() => {
    if (id !== null) fit();
  });
  paneObserver.observe(container);

  const info = await daemon.openSession({
    onLine: (raw) => {
      if (raw.startsWith("O:")) {
        enqueueWrite(() => term.write("\r\n" + raw.slice(2)));
      } else if (raw.startsWith("E:")) {
        enqueueWrite(() => term.write(`\r\n\x1b[31m${raw.slice(2)}\x1b[0m`));
      } else if (raw.startsWith("D:")) {
        cwd = raw.slice(2);
      } else if (raw.startsWith("X:")) {
        jobRunning = false;
        prompt();
      }
    },
    onPty: (bytes) => enqueueWrite(() => term.write(bytes)),
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

    // The job has ended but its prompt hasn't rendered yet — see
    // awaitingPrompt. Dropping the keystroke loses a few milliseconds of
    // typing at worst; accepting it would echo the character above the
    // prompt line and leave the editor's buffer disagreeing with what's
    // on screen for the rest of the line.
    if (awaitingPrompt) return;

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
    if (data.charCodeAt(0) < 32) {
      // Other control chars while composing a line (Ctrl+D, ...) — no
      // running job to send them to, and no local meaning either. (Ctrl+A/
      // C/E/Z never reach here — they're caught by keymap-driven combos in
      // attachCustomKeyEventHandler below, before xterm.js turns them into
      // data bytes at all.)
      return;
    }
    editor.insertText(data);
  });

  // Ctrl+C — the interrupt/cancel shortcut, whatever it's bound to (see
  // keymap.js). While a job's running, the pty's line discipline is what
  // actually turns \x03 into SIGINT for the foreground process group (see
  // meerkat-daemon's evaluator.ex — a real pty in canonical mode); we just
  // forward the byte. While composing, there's no process to signal, so
  // this instead does what every shell does on Ctrl+C at an empty/partial
  // prompt: echo "^C", abandon the line, and start fresh.
  function doInterrupt() {
    if (jobRunning) {
      daemon.sendInput(id, "\x03");
      return;
    }
    if (awaitingPrompt) return;
    if (completion.isActive()) completion.close();
    // Queued rather than written directly, so "^C" can't jump ahead of
    // output still draining from the job that just ended.
    enqueueWrite(() => term.write("^C\x1b[0m\r\n"));
    editor.reset();
    prompt();
  }

  // Ctrl+Z — kills the running foreground job outright (see app.go's
  // KillJob / meerkat-daemon's "K" message). Real terminals suspend
  // (SIGTSTP) here, but meerkat has no fg/bg wired up to the GUI, so a
  // true suspend would just wedge the tab forever with no way to resume —
  // killing it is what's actually useful. No-op while composing: there's
  // no foreground job to kill yet.
  function doKillJob() {
    if (jobRunning) daemon.killJob(id);
  }

  // Intercepts every remappable shortcut before xterm.js converts it to
  // bytes/escape sequences — needed rather than checking in onData, for a
  // few reasons:
  //
  // - Ctrl+C/Ctrl+Z need custom local behavior (above) instead of xterm's
  //   default \x03/\x1a passthrough.
  // - Cmd+M is ASCII 0x0D, identical to Enter/"\r", so without catching
  //   the raw KeyboardEvent here (which still distinguishes metaKey+
  //   key:"m" from a plain Enter press) a physical Cmd+M would otherwise
  //   just submit the current line instead of opening the overlay.
  // - Cmd+Left/Right, Option+Left/Right, and the delete variants aren't
  //   reliably turned into a distinguishable escape sequence by xterm.js's
  //   default keymap at all, so there's nothing for onData/handleEscape to
  //   key off of — reading event.ctrlKey/metaKey/altKey/key directly is
  //   the only robust way to catch them, and it's also exactly the shape
  //   keymap.matches() compares against (what preferencesOverlay.js
  //   records when the user rebinds one of these).
  //
  // Returning false tells xterm.js to swallow the event entirely — it
  // never reaches onData. Line-editing shortcuts (word/line jumps,
  // deletes) only apply while composing a command with no completion menu
  // open — while a job is running the pty owns keystrokes (real programs
  // may want Option+Arrow themselves), and jumping the cursor while a
  // completion menu is displayed would leave it open but stale.
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;

    if (keymap.matches(event, "toggleFullscreen")) {
      event.preventDefault();
      window.runtime.WindowIsFullscreen().then((isFullscreen) => {
        if (isFullscreen) {
          window.runtime.WindowUnfullscreen();
        } else {
          window.runtime.WindowFullscreen();
        }
      });
      return false;
    }
    if (keymap.matches(event, "newTab")) {
      event.preventDefault();
      onNewTabRequested();
      return false;
    }
    if (keymap.matches(event, "toggleSidebar")) {
      event.preventDefault();
      onToggleSidebarRequested();
      return false;
    }
    // Checked before splitRight: with the default bindings the two differ
    // only by Shift, and keymap.matches compares modifiers exactly, so
    // order doesn't actually matter — but it does the moment someone
    // rebinds one of them to a prefix of the other.
    if (keymap.matches(event, "splitDown")) {
      event.preventDefault();
      onSplitRequested("column");
      return false;
    }
    if (keymap.matches(event, "splitRight")) {
      event.preventDefault();
      onSplitRequested("row");
      return false;
    }
    if (keymap.matches(event, "interrupt")) {
      event.preventDefault();
      doInterrupt();
      return false;
    }
    if (keymap.matches(event, "killJob")) {
      event.preventDefault();
      doKillJob();
      return false;
    }

    if (!jobRunning && !completion.isActive()) {
      if (keymap.matches(event, "lineHome")) {
        event.preventDefault();
        editor.moveCursorTo(0);
        return false;
      }
      if (keymap.matches(event, "lineEnd")) {
        event.preventDefault();
        editor.moveCursorTo(editor.getLine().length);
        return false;
      }
      if (keymap.matches(event, "cmdLineHome")) {
        event.preventDefault();
        editor.moveCursorTo(0);
        return false;
      }
      if (keymap.matches(event, "cmdLineEnd")) {
        event.preventDefault();
        editor.moveCursorTo(editor.getLine().length);
        return false;
      }
      if (keymap.matches(event, "wordLeft")) {
        event.preventDefault();
        editor.moveCursorTo(editor.wordLeftPos(editor.getCursor()));
        return false;
      }
      if (keymap.matches(event, "wordRight")) {
        event.preventDefault();
        editor.moveCursorTo(editor.wordRightPos(editor.getCursor()));
        return false;
      }
      // Delete the word behind the cursor.
      if (keymap.matches(event, "deleteWordLeft")) {
        event.preventDefault();
        editor.deleteRange(editor.wordLeftPos(editor.getCursor()), editor.getCursor());
        return false;
      }
      // Delete from line start to the cursor.
      if (keymap.matches(event, "deleteToLineStart")) {
        event.preventDefault();
        editor.deleteRange(0, editor.getCursor());
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
      paneObserver.disconnect();
      unsubscribeAppearance();
      daemon.closeSession(id);
      term.dispose();
    },
  };
}
