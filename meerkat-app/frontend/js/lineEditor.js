// Local "cooked mode" editing of the line being composed. The daemon sees
// nothing until Enter; once a job is running the pty takes over instead (see
// session.js's jobRunning branch).
//
// The line is modelled as code points, not UTF-16 units, so Backspace over an
// emoji removes the whole character instead of leaving half a surrogate pair
// to be sent to the daemon. Every edit redraws the whole line from the prompt
// and then positions the cursor from the model: a cell count per character
// (CJK and emoji take two) and the terminal width give the row and column, so
// editing works across soft-wrapped rows, where plain CUB/CUF would stop at
// the row edge and EL would clear a single row.
//
// Positions in the public API (getCursor, moveCursorTo, replaceRange, the
// word-boundary helpers) are UTF-16 indices into getLine(), because that is
// what the callers slice strings with.
export function createLineEditor(term) {
  /** @type {string[]} code points */
  let chars = [];
  /** index into `chars` */
  let cur = 0;

  // Where the prompt left the terminal cursor: the column on the prompt's row
  // at which the line starts. Cells are counted from column 0 of that row.
  let promptCol = 0;
  // The terminal cursor as this module last left it: its cell (promptCol +
  // width of the text before it) and its row relative to the prompt's row.
  let curCell = 0;
  let curRow = 0;

  function cols() {
    return term.cols || 80;
  }

  function getLine() {
    return chars.join("");
  }

  function getCursor() {
    return chars.slice(0, cur).join("").length;
  }

  // UTF-16 index -> code point index (clamped, rounded down to a boundary).
  function toCharIndex(utf16Index) {
    let units = 0;
    for (let i = 0; i < chars.length; i++) {
      if (units >= utf16Index) return i;
      units += chars[i].length;
    }
    return chars.length;
  }

  function widthBefore(charIndex) {
    let w = 0;
    for (let i = 0; i < charIndex; i++) w += charWidth(chars[i]);
    return w;
  }

  function reset() {
    chars = [];
    cur = 0;
    curCell = promptCol;
    curRow = 0;
  }

  // Called once the prompt is on screen, before any keystroke is accepted.
  function setPromptColumn(col) {
    promptCol = col;
    curCell = col;
    curRow = 0;
  }

  // Moves the terminal cursor from where it is to `cell`. Downward moves are
  // line feeds rather than CUD: the target row may not exist yet when the text
  // ends exactly at the right edge, and only a line feed scrolls one in.
  function moveToCell(cell) {
    const targetRow = Math.floor(cell / cols());
    const up = curRow - targetRow;
    let seq = "";
    if (up > 0) seq += `\x1b[${up}A`;
    else if (up < 0) seq += "\n".repeat(-up);
    seq += `\x1b[${(cell % cols()) + 1}G`;
    term.write(seq);
    curCell = cell;
    curRow = targetRow;
  }

  // Redraws the line from the prompt and puts the cursor at `cur`.
  function render() {
    moveToCell(promptCol);
    const text = getLine();
    const endCell = promptCol + widthBefore(chars.length);
    term.write("\x1b[J" + text);

    // A character written into the last column leaves the cursor *on* that
    // column with a pending wrap, not at column 0 of the next row.
    const pendingWrap = endCell > promptCol && endCell % cols() === 0;
    curCell = endCell;
    curRow = pendingWrap ? endCell / cols() - 1 : Math.floor(endCell / cols());

    const target = promptCol + widthBefore(cur);
    if (target === endCell) {
      // "\r\n" rather than a cursor move: the cursor belongs at the start of
      // a row that may not exist yet, and only a newline scrolls one in.
      if (pendingWrap) {
        term.write("\r\n");
        curRow += 1;
      }
      return;
    }
    moveToCell(target);
  }

  function insertText(text) {
    const inserted = Array.from(text);
    chars.splice(cur, 0, ...inserted);
    cur += inserted.length;
    render();
  }

  function backspace() {
    if (cur === 0) return;
    chars.splice(cur - 1, 1);
    cur -= 1;
    render();
  }

  // `delta` is in characters.
  function moveCursor(delta) {
    const next = Math.max(0, Math.min(chars.length, cur + delta));
    if (next === cur) return;
    cur = next;
    moveToCell(promptCol + widthBefore(cur));
  }

  function moveCursorTo(utf16Index) {
    moveCursor(toCharIndex(utf16Index) - cur);
  }

  // Word-jump/word-delete stops at these as well as space, so
  // "foo-bar/baz:qux" isn't treated as one word.
  const WORD_BOUNDARY_CHARS = new Set([" ", "-", "/", '"', "'", "{", "[", ":", "."]);

  function isWordChar(ch) {
    return ch !== undefined && !WORD_BOUNDARY_CHARS.has(ch);
  }

  function wordLeftPos(utf16Index) {
    let i = toCharIndex(utf16Index);
    while (i > 0 && !isWordChar(chars[i - 1])) i--;
    while (i > 0 && isWordChar(chars[i - 1])) i--;
    return chars.slice(0, i).join("").length;
  }

  function wordRightPos(utf16Index) {
    let i = toCharIndex(utf16Index);
    const n = chars.length;
    while (i < n && !isWordChar(chars[i])) i++;
    while (i < n && isWordChar(chars[i])) i++;
    return chars.slice(0, i).join("").length;
  }

  function deleteRange(start, end) {
    replaceRange(start, end, "");
  }

  // Replaces [start, end) (UTF-16 indices) with `text`, leaving the cursor
  // after the inserted text.
  function replaceRange(start, end, text) {
    const from = toCharIndex(Math.min(start, end));
    const to = toCharIndex(Math.max(start, end));
    const inserted = Array.from(text);
    chars.splice(from, to - from, ...inserted);
    cur = from + inserted.length;
    render();
  }

  return {
    getLine,
    getCursor,
    reset,
    setPromptColumn,
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

// Display width of one code point, after wcwidth: 0 for combining marks and
// other zero-width characters, 2 for East Asian wide/fullwidth and emoji, 1
// otherwise. The ranges follow the ones xterm.js uses to lay the glyphs out,
// which is what the cursor has to agree with.
export function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (inRanges(cp, ZERO_WIDTH)) return 0;
  if (inRanges(cp, WIDE)) return 2;
  return 1;
}

function inRanges(cp, ranges) {
  for (const [lo, hi] of ranges) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}

// Sorted, inclusive.
const ZERO_WIDTH = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0711, 0x0711],
  [0x0730, 0x074a],
  [0x07a6, 0x07b0],
  [0x0900, 0x0902],
  [0x093c, 0x093c],
  [0x0941, 0x0948],
  [0x094d, 0x094d],
  [0x0951, 0x0954],
  [0x0962, 0x0963],
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0x20d0, 0x20f0],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xfeff, 0xfeff],
  [0x1f3fb, 0x1f3ff],
  [0xe0100, 0xe01ef],
];

// Sorted, inclusive.
const WIDE = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x17000, 0x18aff],
  [0x1b000, 0x1b2ff],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f251],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];
