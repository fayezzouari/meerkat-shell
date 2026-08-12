// Owns the bindings only; callers look up an action's combo and decide the
// effect themselves, which is what lets preferencesOverlay.js edit the whole
// list generically.
//
// Bump the version to push a changed default to existing installs: persist()
// writes the whole map, so a stored binding otherwise freezes the old default
// forever. (v2 = the sidebar toggle moving off Cmd+M.)
const STORAGE_KEY = "meerkat.keybindings.v2";

// `default` is {key, ctrl, alt, meta, shift}; `key` matches KeyboardEvent.key
// (single letters lower-cased, special keys by DOM name).
export const ACTIONS = [
  {
    id: "interrupt",
    label: "Cancel / Interrupt",
    description: "Clears the line you're typing, or sends Ctrl+C to a running command.",
    default: { key: "c", ctrl: true },
  },
  {
    id: "killJob",
    label: "Kill Running Command",
    description: "Terminates the currently running foreground command outright.",
    default: { key: "z", ctrl: true },
  },
  {
    id: "lineHome",
    label: "Cursor to Line Start",
    default: { key: "a", ctrl: true },
  },
  {
    id: "lineEnd",
    label: "Cursor to Line End",
    default: { key: "e", ctrl: true },
  },
  {
    id: "wordLeft",
    label: "Cursor One Word Left",
    default: { key: "ArrowLeft", alt: true },
  },
  {
    id: "wordRight",
    label: "Cursor One Word Right",
    default: { key: "ArrowRight", alt: true },
  },
  {
    id: "cmdLineHome",
    label: "Cursor to Line Start (Cmd)",
    default: { key: "ArrowLeft", meta: true },
  },
  {
    id: "cmdLineEnd",
    label: "Cursor to Line End (Cmd)",
    default: { key: "ArrowRight", meta: true },
  },
  {
    id: "deleteWordLeft",
    label: "Delete Word Left",
    default: { key: "Backspace", alt: true },
  },
  {
    id: "deleteToLineStart",
    label: "Delete to Line Start",
    default: { key: "Backspace", meta: true },
  },
  {
    id: "newTab",
    label: "New Tab",
    default: { key: "t", meta: true },
  },
  {
    id: "splitRight",
    label: "Split Pane Right",
    description: "Opens a second terminal beside this one, in the same directory.",
    default: { key: "d", meta: true },
  },
  {
    id: "splitDown",
    label: "Split Pane Down",
    description: "Opens a second terminal below this one, in the same directory.",
    default: { key: "d", meta: true, shift: true },
  },
  {
    id: "toggleSidebar",
    label: "Toggle Sidebar",
    description: "Shows open panes, git worktrees, and running jobs alongside the terminal.",
    // Not Cmd+M: Cocoa resolves that to Minimize before the webview ever
    // sees the keystroke.
    default: { key: "b", meta: true },
  },
  {
    id: "toggleFullscreen",
    label: "Toggle Fullscreen",
    default: { key: "f", meta: true, ctrl: true },
  },
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

let bindings = null;

function normalizeKey(key) {
  return key.length === 1 ? key.toLowerCase() : key;
}

function load() {
  if (bindings) return bindings;
  bindings = {};
  for (const a of ACTIONS) bindings[a.id] = a.default;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    for (const id of Object.keys(stored)) {
      if (BY_ID.has(id)) bindings[id] = stored[id];
    }
  } catch (e) {
    // Corrupt/missing storage — defaults already in place above.
  }
  return bindings;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

export function getBinding(id) {
  return load()[id];
}

export function setBinding(id, combo) {
  if (!BY_ID.has(id)) return;
  load();
  bindings[id] = combo;
  persist();
}

export function resetBinding(id) {
  const action = BY_ID.get(id);
  if (!action) return;
  setBinding(id, action.default);
}

export function resetAll() {
  bindings = null;
  localStorage.removeItem(STORAGE_KEY);
  load();
}

export function comboFromEvent(event) {
  return {
    key: normalizeKey(event.key),
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

export function matches(event, id) {
  const combo = getBinding(id);
  if (!combo) return false;
  const e = comboFromEvent(event);
  return (
    e.key === normalizeKey(combo.key) &&
    !!e.ctrl === !!combo.ctrl &&
    !!e.alt === !!combo.alt &&
    !!e.meta === !!combo.meta &&
    !!e.shift === !!combo.shift
  );
}

const KEY_LABELS = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Backspace: "⌫",
  Delete: "⌦",
  " ": "Space",
};

// macOS symbol style, e.g. "⌘⌥⌫".
export function describeCombo(combo) {
  if (!combo) return "";
  let out = "";
  if (combo.ctrl) out += "⌃";
  if (combo.alt) out += "⌥";
  if (combo.shift) out += "⇧";
  if (combo.meta) out += "⌘";
  out += KEY_LABELS[combo.key] || combo.key.toUpperCase();
  return out;
}

export function listActions() {
  return ACTIONS.map((a) => ({ ...a, binding: getBinding(a.id) }));
}
