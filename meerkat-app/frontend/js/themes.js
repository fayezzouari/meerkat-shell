// Named color presets. Colors only — every preset shares the same fonts,
// spacing, and layout (those live in index.html / theme.js); switching a
// theme only swaps values, never metrics, so nothing reflows and the
// terminal never needs re-fitting on a theme change.
//
// Each preset carries two halves that have to agree with each other:
//   `chrome`   — the CSS custom properties index.html's rules are written
//                against, applied to <html> by applyTheme below.
//   `terminal` — the xterm.js theme object for the canvas itself.
// `terminal.background` is deliberately the chrome's raised surface, not
// its base: the terminal canvas sits inside .pane, so matching bgRaised is
// what keeps the active tab visually connected to the pane instead of
// ringing the grid with a lighter frame.
//
// The 16 ANSI colors aren't decorative — programs pick them by index (ls
// directory blue, git diff red/green, the prompt's cyan repo + yellow
// branch from promptInfo.js), so each preset has to define all of them
// legibly against its own background rather than inheriting a default.

const STORAGE_KEY = "meerkat.theme.v1";

export const THEMES = [
  {
    id: "clay",
    name: "Clay",
    description: "Warm near-black and cream, terracotta accent.",
    chrome: {
      bg: "#1b1917",
      bgRaised: "#232120",
      bgHover: "rgba(245, 242, 234, 0.06)",
      border: "rgba(245, 242, 234, 0.09)",
      text: "#f5f2ea",
      textDim: "#a09a90",
      textFaint: "#6b655d",
      accent: "#d97757",
      backdrop: "rgba(18, 16, 15, 0.62)",
      danger: "#f08a72",
      warning: "#d9a94d",
    },
    terminal: {
      background: "#232120",
      foreground: "#b8b2a7",
      cursor: "#f5f2ea",
      cursorAccent: "#232120",
      selectionBackground: "#3d3833",
      black: "#1b1917",
      red: "#e0705c",
      green: "#8aa872",
      yellow: "#d9a94d",
      blue: "#7d9bc4",
      magenta: "#b98bc4",
      cyan: "#6fb0a8",
      white: "#c9c3b8",
      brightBlack: "#6b655d",
      brightRed: "#f08a72",
      brightGreen: "#a4c48c",
      brightYellow: "#f0c877",
      brightBlue: "#9bb8dd",
      brightMagenta: "#d0a8db",
      brightCyan: "#8cc9c0",
      brightWhite: "#f5f2ea",
    },
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Neutral cool grey, saturated accents.",
    chrome: {
      bg: "#0b0b0c",
      bgRaised: "#141416",
      bgHover: "rgba(255, 255, 255, 0.05)",
      border: "rgba(255, 255, 255, 0.07)",
      text: "#d9d9d9",
      textDim: "#7a7a7a",
      textFaint: "#4a4a4a",
      accent: "#6fd1c9",
      backdrop: "rgba(8, 8, 9, 0.62)",
      danger: "#ff7a7a",
      warning: "#d9b84d",
    },
    terminal: {
      background: "#141416",
      foreground: "#a8a8a8",
      cursor: "#ffffff",
      cursorAccent: "#141416",
      selectionBackground: "#3a3a3a",
      black: "#0b0b0c",
      red: "#e05c5c",
      green: "#5cc27a",
      yellow: "#d9b84d",
      blue: "#5c8fe0",
      magenta: "#b874d9",
      cyan: "#4dc4c4",
      white: "#d9d9d9",
      brightBlack: "#707070",
      brightRed: "#ff7a7a",
      brightGreen: "#7ee0a0",
      brightYellow: "#f0d878",
      brightBlue: "#7aa8f0",
      brightMagenta: "#d090f0",
      brightCyan: "#78e0e0",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "fjord",
    name: "Fjord",
    description: "Cool blue-grey, frost accent.",
    chrome: {
      bg: "#1e232b",
      bgRaised: "#262c36",
      bgHover: "rgba(216, 228, 240, 0.06)",
      border: "rgba(216, 228, 240, 0.10)",
      text: "#e2e8f0",
      textDim: "#93a1b3",
      textFaint: "#5d6a7a",
      accent: "#88c0d0",
      backdrop: "rgba(16, 20, 26, 0.62)",
      danger: "#d08770",
      warning: "#ebcb8b",
    },
    terminal: {
      background: "#262c36",
      foreground: "#c3cbd6",
      cursor: "#e2e8f0",
      cursorAccent: "#262c36",
      selectionBackground: "#3d4757",
      black: "#1e232b",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#c3cbd6",
      brightBlack: "#5d6a7a",
      brightRed: "#d08770",
      brightGreen: "#b5d0a0",
      brightYellow: "#f2daa4",
      brightBlue: "#9bb8dd",
      brightMagenta: "#c9a3c2",
      brightCyan: "#a1d4e2",
      brightWhite: "#eceff4",
    },
  },
  {
    id: "moss",
    name: "Moss",
    description: "Deep green-black, sage accent.",
    chrome: {
      bg: "#141a16",
      bgRaised: "#1c231e",
      bgHover: "rgba(226, 240, 228, 0.06)",
      border: "rgba(226, 240, 228, 0.09)",
      text: "#e6ece5",
      textDim: "#94a394",
      textFaint: "#5c6a5d",
      accent: "#8fbf7f",
      backdrop: "rgba(12, 16, 13, 0.62)",
      danger: "#e69485",
      warning: "#d4bd76",
    },
    terminal: {
      background: "#1c231e",
      foreground: "#b3bfb2",
      cursor: "#e6ece5",
      cursorAccent: "#1c231e",
      selectionBackground: "#36453a",
      black: "#141a16",
      red: "#d1786c",
      green: "#8fbf7f",
      yellow: "#d4bd76",
      blue: "#7fa8b8",
      magenta: "#b294bb",
      cyan: "#79b8ab",
      white: "#b3bfb2",
      brightBlack: "#5c6a5d",
      brightRed: "#e69485",
      brightGreen: "#a9d69a",
      brightYellow: "#e8d494",
      brightBlue: "#9dc4d2",
      brightMagenta: "#c9b0d1",
      brightCyan: "#95d2c5",
      brightWhite: "#f0f5ef",
    },
  },
  {
    id: "ember",
    name: "Ember",
    description: "Near-black with amber and rust.",
    chrome: {
      bg: "#17130f",
      bgRaised: "#201a15",
      bgHover: "rgba(245, 232, 216, 0.06)",
      border: "rgba(245, 232, 216, 0.09)",
      text: "#f2e8dc",
      textDim: "#a3937f",
      textFaint: "#6d5f4f",
      accent: "#e0913f",
      backdrop: "rgba(14, 11, 8, 0.62)",
      danger: "#ea8163",
      warning: "#e0913f",
    },
    terminal: {
      background: "#201a15",
      foreground: "#c2b3a1",
      cursor: "#f2e8dc",
      cursorAccent: "#201a15",
      selectionBackground: "#42352a",
      black: "#17130f",
      red: "#d4674a",
      green: "#9aa85e",
      yellow: "#e0913f",
      blue: "#7f9bab",
      magenta: "#b57f9c",
      cyan: "#6faa9c",
      white: "#c2b3a1",
      brightBlack: "#6d5f4f",
      brightRed: "#ea8163",
      brightGreen: "#b6c479",
      brightYellow: "#f5ab5c",
      brightBlue: "#9db8c7",
      brightMagenta: "#cf9bb6",
      brightCyan: "#8cc4b6",
      brightWhite: "#fdf4e8",
    },
  },
  {
    id: "parchment",
    name: "Parchment",
    description: "Light — warm paper with ink-dark text.",
    chrome: {
      bg: "#e8e4da",
      bgRaised: "#f4f1ea",
      bgHover: "rgba(40, 36, 30, 0.06)",
      border: "rgba(40, 36, 30, 0.12)",
      text: "#2a2621",
      textDim: "#6b6459",
      textFaint: "#9c9488",
      accent: "#b8562f",
      backdrop: "rgba(120, 112, 100, 0.35)",
      danger: "#b8402f",
      warning: "#9a7318",
    },
    terminal: {
      background: "#f4f1ea",
      foreground: "#403a32",
      cursor: "#2a2621",
      cursorAccent: "#f4f1ea",
      selectionBackground: "#d6cfc0",
      black: "#2a2621",
      red: "#b8402f",
      green: "#4f7a3d",
      yellow: "#9a7318",
      blue: "#2f5f9e",
      magenta: "#8a4a91",
      cyan: "#256d6a",
      white: "#6b6459",
      brightBlack: "#9c9488",
      brightRed: "#d05a45",
      brightGreen: "#679553",
      brightYellow: "#b58b2a",
      brightBlue: "#4a7cbb",
      brightMagenta: "#a463ab",
      brightCyan: "#3a8a86",
      brightWhite: "#403a32",
    },
  },
];

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));
const DEFAULT_ID = "clay";

let currentId = null;
const subscribers = new Set(); // fn(theme) — notified on every applyTheme.

export function getThemeId() {
  if (currentId) return currentId;
  const stored = localStorage.getItem(STORAGE_KEY);
  currentId = BY_ID.has(stored) ? stored : DEFAULT_ID;
  return currentId;
}

export function getTheme() {
  return BY_ID.get(getThemeId());
}

// Pushes `theme.chrome` onto :root as the CSS custom properties every rule
// in index.html reads, then hands the theme to subscribers (each open
// session, so its Terminal can swap its own canvas palette).
export function applyTheme(id) {
  const theme = BY_ID.get(id) || BY_ID.get(DEFAULT_ID);
  currentId = theme.id;
  localStorage.setItem(STORAGE_KEY, theme.id);

  const root = document.documentElement.style;
  root.setProperty("--bg", theme.chrome.bg);
  root.setProperty("--bg-raised", theme.chrome.bgRaised);
  root.setProperty("--bg-hover", theme.chrome.bgHover);
  root.setProperty("--border", theme.chrome.border);
  root.setProperty("--text", theme.chrome.text);
  root.setProperty("--text-dim", theme.chrome.textDim);
  root.setProperty("--text-faint", theme.chrome.textFaint);
  root.setProperty("--accent", theme.chrome.accent);
  root.setProperty("--backdrop", theme.chrome.backdrop);
  root.setProperty("--danger", theme.chrome.danger);
  root.setProperty("--warning", theme.chrome.warning);

  subscribers.forEach((fn) => fn(theme));
  return theme;
}

// Subscribe to theme changes; returns an unsubscribe function. Called
// immediately with the current theme so callers don't need a separate
// "apply the initial value" step.
export function onThemeChange(fn) {
  subscribers.add(fn);
  fn(getTheme());
  return () => subscribers.delete(fn);
}
