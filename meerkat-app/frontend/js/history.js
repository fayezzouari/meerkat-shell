// Command history for Up/Down arrow browsing — the CLI (meerkat-client)
// gets this for free from the chzyer/readline library it uses, but the
// GUI's hand-rolled line editor never had an equivalent. Session-only
// (not persisted to disk): each Terminal.onData handler wires Up/Down to
// up(editor)/down(editor), which swap the recalled entry into the current
// line via lineEditor's replaceRange.
export function createHistory() {
  const entries = [];
  // -1 means "editing the live draft, not browsing history"; otherwise an
  // index into `entries`, oldest-to-newest, moved toward 0 by Up.
  let index = -1;
  let draft = "";

  // Called on Enter with whatever was just submitted.
  function record(line) {
    if (line.trim() === "") return;
    if (entries.length > 0 && entries[entries.length - 1] === line) {
      index = -1; // still dedupe adjacent repeats, but nothing new to store
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
    // else: already at the oldest entry, nothing to do.
  }

  function down(editor) {
    if (index === -1) return; // not browsing — nothing to move toward.
    if (index < entries.length - 1) {
      recall(editor, index + 1);
    } else {
      recall(editor, -1); // past the newest entry — back to the live draft.
    }
  }

  return { record, up, down };
}
