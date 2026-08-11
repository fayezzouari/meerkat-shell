import { getTheme } from "./themes.js";

// Non-color Terminal construction options — the typography and cursor
// settings every session shares. Colors are NOT here: they come from the
// active named preset (themes.js) and can change at runtime, so they're
// merged in below rather than frozen into a constant.
//
// The font must be monospace. xterm.js lays every character into a
// fixed-width cell sized from a single glyph measurement, so a
// proportional face still gets forced into that grid — which shows up as
// huge gaps after narrow letters, not as proportional text.
const baseOptions = {
  fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
  fontSize: 13,
  fontWeight: 500,
  fontWeightBold: 700,
  cursorStyle: "bar",
  cursorBlink: true,
};

// Options for a newly-created Terminal, using whichever preset is active
// at construction time. Sessions created later pick up the current one;
// sessions already open are updated in place by session.js's
// onThemeChange subscription.
export function terminalOptions() {
  return { ...baseOptions, theme: getTheme().terminal };
}
