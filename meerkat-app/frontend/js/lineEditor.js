// Local "cooked mode" editing of the line being composed. The daemon sees
// nothing until Enter; once a job is running the pty takes over instead (see
// session.js's jobRunning branch).
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

  // Word-jump/word-delete stops at these as well as space, so
  // "foo-bar/baz:qux" isn't treated as one word.
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

  function deleteRange(start, end) {
    replaceRange(start, end, "");
  }

  // Assumes the terminal cursor is currently at `end` — true right after Tab,
  // or after a previous replaceRange.
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
