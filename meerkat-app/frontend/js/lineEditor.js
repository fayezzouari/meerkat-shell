// Local "cooked mode" editing of the command line being composed — echo,
// backspace, cursor movement, word jumps. The daemon never sees any of
// this until Enter sends the full line (see main.js's term.onData); once a
// job is running, none of it applies — see the `jobRunning` branch there,
// which forwards keystrokes straight to the job's pty instead.
//
// State (the line buffer and cursor position) lives in this module's
// closure rather than as free-standing globals, so main.js and
// completion.js both go through the same accessors instead of touching
// shared mutable variables directly.
export function createLineEditor(term) {
  let line = "";
  let cursor = 0;

  function getLine() {
    return line;
  }

  function getCursor() {
    return cursor;
  }

  function reset() {
    line = "";
    cursor = 0;
  }

  function insertText(text) {
    const after = line.slice(cursor);
    line = line.slice(0, cursor) + text + after;
    term.write(text + after);
    if (after.length > 0) term.write(`\x1b[${after.length}D`);
    cursor += text.length;
  }

  function backspace() {
    if (cursor === 0) return;
    const after = line.slice(cursor);
    line = line.slice(0, cursor - 1) + after;
    cursor -= 1;
    term.write("\b" + after + " ");
    term.write(`\x1b[${after.length + 1}D`);
  }

  function moveCursor(delta) {
    const newPos = Math.max(0, Math.min(line.length, cursor + delta));
    const diff = newPos - cursor;
    if (diff === 0) return;
    term.write(diff > 0 ? `\x1b[${diff}C` : `\x1b[${-diff}D`);
    cursor = newPos;
  }

  function moveCursorTo(pos) {
    moveCursor(pos - cursor);
  }

  // Characters that end a "word" for word-jump/word-delete purposes, same
  // as space — path separators, quotes, and the openers of the bracket
  // pairs meerkat's own parser cares about, so Option+Left/Right/Delete
  // stops at "foo-bar/baz:qux" boundaries instead of treating the whole
  // thing as one word.
  const WORD_BOUNDARY_CHARS = new Set([" ", "-", "/", '"', "'", "{", "[", ":", "."]);

  function isWordChar(ch) {
    return ch !== undefined && !WORD_BOUNDARY_CHARS.has(ch);
  }

  function wordLeftPos(pos) {
    let i = pos;
    while (i > 0 && !isWordChar(line[i - 1])) i--;
    while (i > 0 && isWordChar(line[i - 1])) i--;
    return i;
  }

  function wordRightPos(pos) {
    let i = pos;
    const n = line.length;
    while (i < n && !isWordChar(line[i])) i++;
    while (i < n && isWordChar(line[i])) i++;
    return i;
  }

  // Deletes line[start:end] — just replaceRange with empty text, but
  // named for what callers (Option+Delete/Cmd+Delete below) actually mean.
  function deleteRange(start, end) {
    replaceRange(start, end, "");
  }

  // Replaces line[start:end] with `text` and redraws — the same
  // cursor-relative rewrite technique insertText/backspace use above: move
  // the terminal cursor back to `start`, erase to end of line, rewrite.
  // Used by completion.js to swap a candidate into the word being
  // completed; assumes the terminal's cursor is currently at `end`
  // (true right after Tab, or after a previous replaceRange call).
  function replaceRange(start, end, text) {
    const restAfter = line.slice(end);

    const back = cursor - start;
    if (back > 0) term.write(`\x1b[${back}D`);
    term.write("\x1b[K" + text + restAfter);
    if (restAfter.length > 0) term.write(`\x1b[${restAfter.length}D`);

    line = line.slice(0, start) + text + restAfter;
    cursor = start + text.length;
  }

  return {
    getLine,
    getCursor,
    reset,
    insertText,
    backspace,
    moveCursor,
    moveCursorTo,
    wordLeftPos,
    wordRightPos,
    replaceRange,
    deleteRange,
  };
}
