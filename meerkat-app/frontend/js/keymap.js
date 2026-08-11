// The single source of truth for every remappable keyboard shortcut in the
// app — what physical key combo triggers which action, the shipped
// defaults, persistence, and matching a KeyboardEvent against a combo.
//
// This module only owns the *bindings*; it has no idea what "wordLeft"
// actually does — session.js (and main.js for the couple of global ones)
// look up an action's combo here and decide the effect themselves. That
// split is what lets preferencesOverlay.js render/edit the whole list
// generically, without needing to know what each action means either.
//
// Persisted to localStorage rather than round-tripping through Go: Wails'
// webview keeps its own on-disk profile per app (same as any browser
// profile), so this survives restarts with no daemon/Go involvement at all.
const STORAGE_KEY = "meerkat.keybindings.v1";

// `default` is {key, ctrl, alt, meta, shift} — `key` matches
// KeyboardEvent.key (single letters stored lower-case; special keys use
// their DOM names, e.g. "ArrowLeft", "Backspace").
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
    id: "toggleJobsOverlay",
    label: "Toggle Sessions/Jobs Overlay",
    default: { key: "m", meta: true },
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

// Normalizes a KeyboardEvent into the same {key, ctrl, alt, meta, shift}
// shape a stored combo has, for comparison and for recording a new one.
export function comboFromEvent(event) {
  return {
    key: normalizeKey(event.key),
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

// Does this KeyboardEvent trigger action `id`, per its current binding
// (default or user-remapped)?
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

// Human-readable combo label for the preferences UI, macOS symbol style
// (e.g. "⌘⌥⌫").
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
