// Tab-completion menu. First Tab (with >1 match) selects and inserts the
// first candidate, highlighted below the prompt; further Tab/Shift+Tab/
// Left/Right cycle the selection and swap it into the line in place — see
// cycle()/applySelected() — rather than reprinting the candidate list from
// scratch each time. Any other key confirms whatever is currently selected
// and closes the menu.
//
// Candidates aren't necessarily prefixed by what was typed — Complete
// (complete.go) also returns substring matches (so "fr" can find
// "prontooo-frontend", which contains but doesn't start with "fr") — so
// completion is always applied by replacing the whole word being
// completed with the candidate (editor.replaceRange), never by computing
// and inserting just a "suffix" the way plain prefix-completion could.
export function createCompletionMenu(term, editor) {
  // { candidates, dirLen, wordStart, index } while a menu is open, else null.
  let state = null;

  function isActive() {
    return state !== null;
  }

  async function open(cwd) {
    const line = editor.getLine();
    const cursor = editor.getCursor();
    const before = line.slice(0, cursor);
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
      editor.replaceRange(wordStart, cursor, candidates[0]);
      return;
    }

    // Candidates come back as full tokens (dir prefix included — needed
    // so applySelected can drop them straight into the line), but showing
    // "prontooo/x  prontooo/y ..." is just noise once you're already
    // inside prontooo/ — display only the part past the directory `word`
    // itself is completing within.
    state = { candidates, dirLen: word.lastIndexOf("/") + 1, wordStart, index: -1 };
    cycle(1);
  }

  // Moves the menu selection by `delta` (wrapping), swaps the newly
  // selected candidate into the line, and redraws the list with the
  // selection highlighted.
  function cycle(delta) {
    const n = state.candidates.length;
    state.index = (state.index + delta + n) % n;
    applySelected();
    render();
  }

  function applySelected() {
    const newWord = state.candidates[state.index];
    editor.replaceRange(state.wordStart, editor.getCursor(), newWord);
  }

  // Draws the candidate list on the line below, selected entry in inverse
  // video, then returns the cursor to right where it was on the input
  // line. \x1b[s/\x1b[u (save/restore cursor) mean this doesn't need to
  // track how many terminal rows the list wraps to — the same total text
  // length gets written every time (only the inverse-video span moves),
  // so there's nothing stale left behind to erase first.
  function render() {
    const items = state.candidates.map((c, i) => {
      const label = c.slice(state.dirLen);
      return i === state.index ? `\x1b[7m${label}\x1b[27m` : label;
    });
    term.write("\x1b[s\r\n" + items.join("  ") + "\x1b[u");
  }

  // Erases the candidate list and drops the menu state.
  function close() {
    if (!state) return;
    term.write("\x1b[s\r\n\x1b[0J\x1b[u");
    state = null;
  }

  // Called on Tab: opens the menu, or cycles it if already open.
  async function handleTab(cwd) {
    if (state) {
      cycle(1);
      return;
    }
    await open(cwd);
  }

  // Called for every other keystroke. Returns true if it consumed the
  // key (menu nav) — false means "not handled, keep processing normally,"
  // which is also the right answer right after closing the menu: whether
  // no menu was open at all, or one just got confirmed/closed by this
  // key, the key still needs its usual handling (Enter submits, typing
  // keeps editing, ...).
  function handleKey(data) {
    if (!state) return false;
    if (data === "\t") {
      cycle(1);
      return true;
    }
    if (data === "\x1b[Z" || data === "\x1b[D") {
      // Shift+Tab, or Left — previous candidate.
      cycle(-1);
      return true;
    }
    if (data === "\x1b[C") {
      // Right — next candidate.
      cycle(1);
      return true;
    }
    close();
    return false;
  }

  return { isActive, handleTab, handleKey, close };
}
