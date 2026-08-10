// Typed commands are bright white (see the "\r" case in main.js's
// term.onData), everything the daemon sends back — builtin output, pty
// output — defaults to a legible grey (theme.foreground). Real ANSI colors
// from programs (ls, vim, ...) come through this 16-color palette, tuned
// to be genuinely colorful rather than desaturated/muted, while still
// keeping the near-black background and grey/white split for the app's
// own text (prompt, results) minimal.
export const terminalOptions = {
  fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
  fontSize: 13,
  fontWeight: 600,
  fontWeightBold: 800,
  cursorStyle: "bar",
  cursorBlink: true,
  theme: {
    background: "#0b0b0c",
    foreground: "#a8a8a8",
    cursor: "#ffffff",
    cursorAccent: "#0b0b0c",
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
};
