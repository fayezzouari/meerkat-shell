import { createLineEditor } from "./lineEditor.js";
import { createCompletionMenu } from "./completion.js";
import { createHistory } from "./history.js";
import * as daemon from "./daemonClient.js";
import { locationFor } from "./promptInfo.js";
import * as keymap from "./keymap.js";
import { onAppearanceChange, terminalOptionsFor } from "./appearance.js";

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

  const editor = createLineEditor(term);
  const completion = createCompletionMenu(term, editor);
  const history = createHistory();

  let id = null;
  let cwd = "~";

  // While true, keystrokes go raw to the job's pty instead of the local line
  // editor — the pty (pty_echo on) is what echoes them back.
  let jobRunning = false;

  // True from the moment a job ends until its prompt is actually on screen.
  // The line editor must not accept keystrokes in that gap: local echo would
  // draw the character *before* the prompt it belongs after.
  let awaitingPrompt = false;

  // Serializes every write that isn't a direct response to a keystroke.
  // prompt() awaits IPC before writing, so without chaining, pty bytes queued
  // behind a finished job would land in the middle of the prompt.
  let writeChain = Promise.resolve();
  function enqueueWrite(fn) {
    writeChain = writeChain.catch(() => {}).then(fn);
    return writeChain;
  }

  // term.write is parsed asynchronously; awaiting its callback is the only way
  // to know the data reached the screen buffer. Callbacks fire in submission
  // order, so this also flushes everything written before it.
  function write(data) {
    return new Promise((resolve) => term.write(data, resolve));
  }

  // Emits the newline only when the cursor isn't already at column 0, so
  // consecutive outputs neither run together nor leave a blank line between
  // them. The empty write is the flush point that makes cursorX current.
  async function writeOnFreshLine(data) {
    await write("");
    const prefix = term.buffer.active.cursorX === 0 ? "" : "\r\n";
    return write(prefix + data);
  }

  // Leaves bright white active with no trailing reset, so the command typed
  // next reads white against the grey output around it.
  function prompt() {
    awaitingPrompt = true;
    return enqueueWrite(async () => {
      const location = await locationFor(cwd);
      await writeOnFreshLine(`\x1b[0m${location} \x1b[97m❯\x1b[0m \x1b[97m`);
      awaitingPrompt = false;
    });
  }

  // Only tell the daemon when the grid size actually changed. A divider drag
  // fires continuously, and every redundant winsz is a SIGWINCH that makes a
  // full-screen program throw away its frame and redraw.
  let lastRows = 0;
  let lastCols = 0;
  function sendResize() {
    if (term.rows === lastRows && term.cols === lastCols) return;
    lastRows = term.rows;
    lastCols = term.cols;
    daemon.sendResize(id, term.rows, term.cols);
  }

  // Skipped while the pane has no size (hidden tab, mid-relayout) — FitAddon
  // would propose a degenerate rows/cols and it would be applied to the pty.
  function fit() {
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    fitAddon.fit();
    sendResize();
  }

  // The first fit() may have measured the fallback font's cell size; re-fit
  // once the real webfont has swapped in.
  document.fonts.ready.then(fit);

  // Registered below `let id` on purpose: onAppearanceChange runs its callback
  // immediately, and reading `id` above its declaration is a TDZ error.
  const unsubscribeAppearance = onAppearanceChange(() => {
    Object.assign(term.options, terminalOptionsFor());
    if (id !== null) fit();
  });

  // Catches pane resizes with no window resize behind them: fullscreen
  // toggles, and the tab bar growing as tabs are added.
  const paneObserver = new ResizeObserver(() => {
    if (id !== null) fit();
  });
  paneObserver.observe(container);

  const info = await daemon.openSession({
    onLine: (raw) => {
      if (raw.startsWith("O:")) {
        enqueueWrite(() => writeOnFreshLine(raw.slice(2)));
      } else if (raw.startsWith("E:")) {
        enqueueWrite(() => writeOnFreshLine(`\x1b[31m${raw.slice(2)}\x1b[0m`));
      } else if (raw.startsWith("D:")) {
        cwd = raw.slice(2);
      } else if (raw.startsWith("X:")) {
        jobRunning = false;
        prompt();
      }
    },
    onPty: (bytes) => enqueueWrite(() => term.write(bytes)),
    onClosed: () => onSessionEnded(id),
  });
  id = info.id;
  cwd = info.cwd || "~";
  // RIS as data rather than term.reset(): reset() acts synchronously while the
  // "connecting..." writeln is still in the async write buffer, which would
  // leave the placeholder on screen above the first prompt.
  term.write("\x1bc");
  // `id` is only just now valid, and the fonts.ready handler above may already
  // have fired (with id null) for cached fonts — it only fires once.
  fit();

  if (initialCwd && initialCwd !== cwd) {
    // Silent: the new tab should just already be there when the prompt
    // appears. Quoted because the parser tokenizes on whitespace with no
    // path-aware special-casing.
    jobRunning = true;
    daemon.sendLine(id, `cd "${initialCwd.replace(/"/g, '\\"')}"`);
  } else {
    prompt();
  }

  // xterm.js hands us a whole escape sequence per keypress, not byte-by-byte.
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
      // Home / Cmd+Left.
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
      case "\x1b[A":
        history.up(editor);
        return;
      case "\x1b[B":
        history.down(editor);
        return;
      default:
        return;
    }
  }

  term.onData((data) => {
    if (jobRunning) {
      daemon.sendInput(id, data);
      return;
    }

    if (awaitingPrompt) return;

    if (completion.handleKey(data)) return;

    if (data === "\r") {
      // Move to a fresh line locally, like a real terminal: raw pty output
      // won't send a leading newline of its own. \x1b[0m drops the white
      // "typing" color set by prompt().
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
      // No running job to send them to, and no local meaning either.
      return;
    }
    editor.insertText(data);
  });

  // While a job runs the pty's line discipline turns \x03 into SIGINT; we just
  // forward the byte. While composing, do what shells do: echo "^C" and start
  // a fresh line.
  function doInterrupt() {
    if (jobRunning) {
      daemon.sendInput(id, "\x03");
      return;
    }
    if (awaitingPrompt) return;
    if (completion.isActive()) completion.close();
    enqueueWrite(() => term.write("^C\x1b[0m\r\n"));
    editor.reset();
    prompt();
  }

  // Kills rather than suspends: meerkat has no fg/bg, so a real SIGTSTP would
  // wedge the tab with no way to resume.
  function doKillJob() {
    if (jobRunning) daemon.killJob(id);
  }

  // Intercepts remappable shortcuts before xterm.js converts them to bytes.
  // Needed because Cmd+M is indistinguishable from Enter at the data layer,
  // and Cmd/Option+Arrow produce no distinguishable sequence at all — the raw
  // KeyboardEvent is also exactly what keymap.matches() compares against.
  // Returning false swallows the event so it never reaches onData.
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
    // Before splitRight, which by default differs only by Shift — matters the
    // moment someone rebinds one to a prefix of the other.
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

    // Line editing only applies while composing with no menu open: a running
    // program may want Option+Arrow itself, and moving the cursor under an
    // open completion menu would leave it stale.
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
      if (keymap.matches(event, "deleteWordLeft")) {
        event.preventDefault();
        editor.deleteRange(editor.wordLeftPos(editor.getCursor()), editor.getCursor());
        return false;
      }
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
