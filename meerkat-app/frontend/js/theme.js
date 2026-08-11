// Typed commands are bright cream (see the "\r" case in session.js's
// term.onData), everything the daemon sends back — builtin output, pty
// output — defaults to a legible warm grey (theme.foreground). Real ANSI
// colors from programs (ls, vim, ...) come through this 16-color palette.
//
// The palette is warm rather than neutral: the background is a soft
// near-black brown and the foreground an off-white cream, matching the
// app chrome's tokens in index.html (--bg-raised / --text) so the
// terminal grid and the pane it sits in read as one surface instead of a
// dark canvas ringed by a lighter frame — which also keeps the active
// tab visually connected to the pane below it. The ANSI
// colors are correspondingly warmed/muted — enough saturation to stay
// distinguishable in `ls`/diff output, not so much that they fight the
// cream-on-brown base. Note prompt colors come through here too:
// promptInfo.js emits cyan (repo), yellow (branch), brightBlack (subpath).
export const terminalOptions = {
  fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
  fontSize: 13,
  fontWeight: 500,
  fontWeightBold: 700,
  cursorStyle: "bar",
  cursorBlink: true,
  theme: {
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
};
