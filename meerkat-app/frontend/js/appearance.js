import { getTheme, onThemeChange } from "./themes.js";

// Composes the themes.js color preset with background opacity, terminal font
// and background image. Downstream (index.html's CSS, each Terminal)
// subscribes via onAppearanceChange rather than reading themes.js directly.
const STORAGE_KEY = "meerkat.appearance.v1";

// Monospace only — xterm.js lays every glyph into a fixed-width cell. The
// webfont entries must also be in scripts/vendor-fonts.sh's FONT_QUERY, or
// they silently fall back to the next family in the stack; the last two are
// system faces and need no entry.
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
export const OPACITY_MIN = 0.3;

// backgroundImagePath is a filesystem path, with two reserved values: this
// sentinel for the shipped Meerkat mark, and "" for no image. A sentinel
// rather than the asset URL, so the bundled file can move without
// invalidating stored settings.
export const DEFAULT_BACKGROUND = "__meerkat__";
const DEFAULT_BACKGROUND_URI = "/assets/meerkat-logo.png";

const DEFAULTS = {
  opacity: 1,
  fontFamily: "jetbrains",
  fontSize: 13,
  backgroundImagePath: DEFAULT_BACKGROUND,
};

let settings = null;
// Resolved data: URI for backgroundImagePath, or "" when unset/unreadable.
// Cached because resolving it round-trips the whole file through Go.
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

function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex; // already rgba(), or unexpected — leave it
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const baseTerminalOptions = {
  fontWeight: 500,
  fontWeightBold: 700,
  cursorStyle: "bar",
  cursorBlink: true,
};

// Must be the *complete* option set: it both constructs a Terminal and, via
// Object.assign, updates a live one.
//
// Opacity lives on exactly one layer — #panes, via --surface-raised — with
// the xterm canvas fully transparent. Tinting both stacks them into a
// darker, seamed result, and tinting the canvas alone leaves the few
// uncovered pixels along the pane's right/bottom edge showing the desktop.
//
// allowTransparency is unconditionally true, not derived from opacity: it's
// a construction-time renderer option, so a Terminal built while opaque
// would bake in `false` and flatten the background forever after.
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

function apply() {
  const s = load();
  const theme = getTheme();
  const root = document.documentElement.style;

  // The chrome uses these translucent variants instead of --bg/--bg-raised,
  // so the whole window fades together.
  root.setProperty("--surface", withAlpha(theme.chrome.bg, s.opacity));
  root.setProperty("--surface-raised", withAlpha(theme.chrome.bgRaised, s.opacity));
  root.setProperty("--font-mono", fontStackFor(s.fontFamily));
  root.setProperty("--bg-image", backgroundImageURI ? `url("${backgroundImageURI}")` : "none");
  // The bundled logo is a mark: fixed small size, centered. A user's own
  // wallpaper is a photo and wants to fill the window.
  root.setProperty("--bg-image-size", s.backgroundImagePath === DEFAULT_BACKGROUND ? "220px auto" : "cover");

  subscribers.forEach((fn) => fn());
}

// Errors are kept rather than thrown, so Preferences can show why an image
// stopped working instead of silently reverting.
async function loadBackgroundImage() {
  const path = load().backgroundImagePath;
  if (!path) {
    backgroundImageURI = "";
    backgroundImageError = "";
    return;
  }
  if (path === DEFAULT_BACKGROUND) {
    // Bundled asset — same origin, so no trip through Go.
    backgroundImageURI = DEFAULT_BACKGROUND_URI;
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
    // Paint the rest now; the image follows once Go has read it off disk.
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

// Returns true if the user actually picked something.
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
  onThemeChange(() => apply());
  await loadBackgroundImage();
  apply();
}
