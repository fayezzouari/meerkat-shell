// Session-only command history for Up/Down browsing; not persisted to disk.
export function createHistory() {
  const entries = [];
  // -1 = editing the live draft; otherwise an index into `entries`.
  let index = -1;
  let draft = "";

  function record(line) {
    if (line.trim() === "") return;
    if (entries.length > 0 && entries[entries.length - 1] === line) {
      index = -1; // dedupe adjacent repeats
      return;
    }
    entries.push(line);
    index = -1;
  }

  function recall(editor, entryIndex) {
    const text = entryIndex === -1 ? draft : entries[entryIndex];
    editor.replaceRange(0, editor.getLine().length, text);
    index = entryIndex;
  }

  function up(editor) {
    if (entries.length === 0) return;
    if (index === -1) {
      draft = editor.getLine();
      recall(editor, entries.length - 1);
    } else if (index > 0) {
      recall(editor, index - 1);
    }
  }

  function down(editor) {
    if (index === -1) return;
    if (index < entries.length - 1) {
      recall(editor, index + 1);
    } else {
      recall(editor, -1); // past the newest — back to the live draft
    }
  }

  return { record, up, down };
}
