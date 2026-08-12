// Candidates aren't necessarily prefixed by what was typed — complete.go also
// returns substring matches — so completion always replaces the whole word
// with the candidate, never inserts a computed suffix.
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

    // Candidates are full tokens so applySelected can drop them straight
    // into the line; dirLen trims the shared directory prefix for display.
    state = { candidates, dirLen: word.lastIndexOf("/") + 1, wordStart, index: -1 };
    cycle(1);
  }

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

  // Save/restore cursor means this needn't track how many rows the list
  // wraps to; the text length never changes, only the inverse-video span.
  function render() {
    const items = state.candidates.map((c, i) => {
      const label = c.slice(state.dirLen);
      return i === state.index ? `\x1b[7m${label}\x1b[27m` : label;
    });
    term.write("\x1b[s\r\n" + items.join("  ") + "\x1b[u");
  }

  function close() {
    if (!state) return;
    term.write("\x1b[s\r\n\x1b[0J\x1b[u");
    state = null;
  }

  async function handleTab(cwd) {
    if (state) {
      cycle(1);
      return;
    }
    await open(cwd);
  }

  // Returns true if the key was consumed as menu navigation. A key that
  // merely closes the menu returns false — it still needs its usual
  // handling.
  function handleKey(data) {
    if (!state) return false;
    if (data === "\t") {
      cycle(1);
      return true;
    }
    if (data === "\x1b[Z" || data === "\x1b[D" || data === "\x1b[A") {
      // Shift+Tab, or Left/Up — previous candidate.
      cycle(-1);
      return true;
    }
    if (data === "\x1b[C" || data === "\x1b[B") {
      // Right/Down — next candidate.
      cycle(1);
      return true;
    }
    if (data === "\r") {
      // Confirms the highlighted candidate (cycle() already put it in the
      // line) and is consumed, so it doesn't also submit the command.
      close();
      return true;
    }
    close();
    return false;
  }

  return { isActive, handleTab, handleKey, close };
}
