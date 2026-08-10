// Minimal, low-color theme: typed commands are bright white (see the "\r"
// case in main.js's term.onData), everything the daemon sends back —
// builtin output, pty output, the prompt's cwd — defaults to a muted grey
// (theme.foreground). Errors stay a desaturated red so they're still
// distinguishable without breaking the otherwise monochrome look. Real ANSI
// colors from programs (ls, vim, ...) still work, just through a
// deliberately desaturated 16-color palette instead of the usual loud
// terminal defaults, to keep those consistent with the rest of the UI.
export const terminalOptions = {
  fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
  fontSize: 13,
  fontWeight: 500,
  fontWeightBold: 700,
  cursorStyle: "bar",
  cursorBlink: true,
  theme: {
    background: "#0b0b0c",
    foreground: "#999999",
    cursor: "#ffffff",
    cursorAccent: "#0b0b0c",
    selectionBackground: "#333333",
    black: "#0b0b0c",
    red: "#b06565",
    green: "#7f9f7f",
    yellow: "#b0a065",
    blue: "#6580b0",
    magenta: "#9a75ad",
    cyan: "#65a0a0",
    white: "#cccccc",
    brightBlack: "#666666",
    brightRed: "#d98a8a",
    brightGreen: "#a3c9a3",
    brightYellow: "#d9c98a",
    brightBlue: "#8aa8d9",
    brightMagenta: "#c2a3d9",
    brightCyan: "#8ac9c9",
    brightWhite: "#ffffff",
  },
};
