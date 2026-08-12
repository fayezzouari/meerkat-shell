import { getTheme, onThemeChange } from "./themes.js";

// Appearance settings that sit *on top of* the color preset: background
// opacity, terminal font, and an optional background image. Where
// themes.js answers "which palette", this answers "how is that palette
// painted" — so the two compose, and changing either recomputes the same
// derived values here.
//
// This module is the only place that turns a theme + these settings into
// what the app actually renders. Everything downstream (index.html's CSS,
// each session's Terminal) subscribes via onAppearanceChange rather than
// reading themes.js directly, so neither has to know the two were ever
// separate concerns.
const STORAGE_KEY = "meerkat.appearance.v1";

// Monospace only, and that is not a stylistic preference — xterm.js lays
// every glyph into a fixed-width cell, so a proportional face renders with
// huge gaps after narrow letters instead of as proportional text. The
// webfont entries must also be present in index.html's Google Fonts link
// or they silently fall back to the next family in the stack.
export const FONT_FAMILIES = [
  { id: "jetbrains", name: "JetBrains Mono", stack: "'JetBrains Mono', Menlo, monospace" },
  { id: "fira", name: "Fira Code", stack: "'Fira Code', Menlo, monospace" },
  { id: "plex", name: "IBM Plex Mono", stack: "'IBM Plex Mono', Menlo, monospace" },
  { id: "source", name: "Source Code Pro", stack: "'Source Code Pro', Menlo, monospace" },
  { id: "sfmono", name: "SF Mono", stack: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace" },
  { id: "menlo", name: "Menlo", stack: "Menlo, Monaco, monospace" },
];

export const FONT_SIZE_MIN = 9;
export const FONT_SIZE_MAX = 24;
// Below roughly this the text stops being readable against a busy
// wallpaper, and the app starts looking broken rather than translucent.
export const OPACITY_MIN = 0.3;

const DEFAULTS = {
  opacity: 1,
  fontFamily: "jetbrains",
  fontSize: 13,
  // Empty by default — the app ships with no wallpaper of its own.
  // Stored as a filesystem path, not image data; see app.go's
  // BackgroundImage for why, and for what happens if it goes missing.
  backgroundImagePath: "",
};

let settings = null;
// Resolved data: URI for backgroundImagePath, or "" when unset/unreadable.
// Cached because reading it means round-tripping the whole file through Go
// and base64 — far too expensive to redo on every re-render.
let backgroundImageURI = "";
let backgroundImageError = "";

const subscribers = new Set();

function load() {
  if (settings) return settings;
  settings = { ...DEFAULTS };
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch (e) {
    // Corrupt storage — defaults are already in place.
  }
  return settings;
}

export function getSettings() {
  return { ...load() };
}

export function getBackgroundImageError() {
  return backgroundImageError;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function fontStackFor(id) {
  return (FONT_FAMILIES.find((f) => f.id === id) || FONT_FAMILIES[0]).stack;
}

// "#rrggbb" + alpha -> "rgba(r, g, b, a)". Themes store plain hex, but
// every surface here needs to be painted at the user's opacity.
function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex; // already rgba(), or something unexpected — leave it
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Terminal options that no setting controls — cursor style and weights.
const baseTerminalOptions = {
  fontWeight: 500,
  fontWeightBold: 700,
  cursorStyle: "bar",
  cursorBlink: true,
};

// The complete Terminal options implied by the current theme + settings.
// Used both to construct a Terminal and, via Object.assign, to update a
// live one — so it has to be the full set, not just the parts that change.
//
// The opacity lives on ONE layer — #panes, via --surface-raised — and the
// xterm canvas on top of it is fully transparent. Both halves of that are
// load-bearing:
//
//   - The tint must be on exactly one layer. Tinting the canvas *and*
//     the element behind it stacks the two, so a requested 50% renders
//     ~75% opaque where they overlap and 50% on the uncovered edge —
//     the slider stops matching what you see, with a visible seam.
//   - It must be the DOM layer, not the canvas, because xterm sizes its
//     canvas to a whole number of cells and always leaves a few pixels
//     uncovered along a pane's right and bottom edge. Tinting the canvas
//     leaves that strip showing the desktop, which reads as a border
//     drawn around every terminal. #panes spans the whole pane.
//
// allowTransparency is unconditionally true, NOT derived from the current
// opacity: it is a construction-time renderer option in xterm.js, so a
// Terminal built while opaque would bake in `false` and the renderer
// would then flatten the transparent background below to opaque. It is a
// capability flag ("this canvas may composite"), not the opacity itself —
// the opacity is --surface-raised, computed from `s.opacity` in apply().
export function terminalOptionsFor() {
  const s = load();
  const theme = getTheme();
  return {
    ...baseTerminalOptions,
    fontFamily: fontStackFor(s.fontFamily),
    fontSize: s.fontSize,
    allowTransparency: true,
    theme: { ...theme.terminal, background: "rgba(0, 0, 0, 0)" },
  };
}

// Pushes the derived values onto :root and notifies subscribers. Called on
// every settings change and whenever the color preset changes underneath.
function apply() {
  const s = load();
  const theme = getTheme();
  const root = document.documentElement.style;

  // Translucent variants of the two surface colors. The chrome uses these
  // instead of --bg/--bg-raised so the whole window fades together rather
  // than leaving an opaque tab bar floating over a see-through terminal.
  root.setProperty("--surface", withAlpha(theme.chrome.bg, s.opacity));
  root.setProperty("--surface-raised", withAlpha(theme.chrome.bgRaised, s.opacity));
  root.setProperty("--font-mono", fontStackFor(s.fontFamily));
  root.setProperty("--bg-image", backgroundImageURI ? `url("${backgroundImageURI}")` : "none");

  subscribers.forEach((fn) => fn());
}

// Resolves backgroundImagePath into a data URI via Go. Errors are kept
// rather than thrown so Preferences can show why an image stopped
// working (moved, deleted, too large) instead of silently reverting.
async function loadBackgroundImage() {
  const path = load().backgroundImagePath;
  if (!path) {
    backgroundImageURI = "";
    backgroundImageError = "";
    return;
  }
  try {
    backgroundImageURI = await window.go.main.App.BackgroundImage(path);
    backgroundImageError = "";
  } catch (err) {
    backgroundImageURI = "";
    backgroundImageError = String(err?.message || err);
  }
}

export function update(patch) {
  load();
  const imageChanged = "backgroundImagePath" in patch && patch.backgroundImagePath !== settings.backgroundImagePath;
  Object.assign(settings, patch);
  persist();

  if (imageChanged) {
    // Paint the rest of the change immediately; the image can only
    // follow once Go has read it off disk.
    apply();
    loadBackgroundImage().then(apply);
    return;
  }
  apply();
}

export function resetAll() {
  settings = { ...DEFAULTS };
  persist();
  loadBackgroundImage().then(apply);
}

// Opens the native picker (app.go) and stores the chosen path. Returns
// true if the user actually picked something.
export async function pickBackgroundImage() {
  const path = await window.go.main.App.PickBackgroundImage();
  if (!path) return false;
  update({ backgroundImagePath: path });
  return true;
}

export function onAppearanceChange(fn) {
  subscribers.add(fn);
  fn();
  return () => subscribers.delete(fn);
}

// Must run before the first session is created so terminals are built with
// the right font and opacity rather than being restyled a frame later.
export async function initAppearance() {
  load();
  // The color preset changing rebuilds every derived value here, since
  // all of them are computed from it.
  onThemeChange(() => apply());
  await loadBackgroundImage();
  apply();
}
