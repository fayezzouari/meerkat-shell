// Page copy, kept out of the components so editing what the site says never
// means editing layout. Pitched at what Meerkat does, not how it is wired —
// the deep detail lives in the repo's READMEs.

export const INSTALL_CMD = "curl -fsSL meerkat.com/install.sh | sh";

export const OPERATING_SYSTEMS = [
  {
    id: "macos",
    name: "macOS 11+",
    detail: "Apple silicon and Intel.",
    // Simplified marks — one path each, drawn on the same 24px grid.
    path: "M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.7.8-3.4.8s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.3 2.9 2.3s1.6-.8 3.1-.8 1.8.7 3 .7 2-1.1 2.8-2.2c.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.7ZM14.3 5.2c.6-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.1 1.8-1 2.9 1.1.1 2.2-.6 2.8-1.4Z",
  },
  {
    id: "linux",
    name: "Linux",
    detail: "Both the terminal app and the command line.",
    path: "M12 2c-1.9 0-3 1.6-3 3.6 0 1 .1 1.9-.3 2.7-.5 1-1.5 2-2.3 3.5-.7 1.3-1.1 2.8-1.6 3.6-.4.7-1 1-.9 1.7.1.6.7.8 1.4 1 .8.2 1.3.7 1.9 1.2.6.5 1.3.9 2.4.9 1.4 0 2.2-.6 2.9-1.1.6-.5 1.1-.9 2-1.1.8-.2 1.5-.4 1.6-1.1.1-.7-.5-1-.9-1.8-.4-.8-.8-2.2-1.5-3.5-.8-1.5-1.8-2.4-2.3-3.4-.4-.8-.3-1.7-.3-2.7C15 3.6 13.9 2 12 2Zm-1.3 3.1c.4 0 .7.5.7 1s-.3 1-.7 1-.7-.5-.7-1 .3-1 .7-1Zm2.6 0c.4 0 .7.5.7 1s-.3 1-.7 1-.7-.5-.7-1 .3-1 .7-1ZM12 8.2c.9 0 1.9.6 1.9 1 0 .3-.4.5-.8.8-.4.3-.8.6-1.1.6s-.7-.3-1.1-.6c-.4-.3-.8-.5-.8-.8 0-.4 1-1 1.9-1Z",
  },
  {
    id: "windows",
    name: "Windows 10/11",
    detail: "Nothing extra to install.",
    path: "M3 4.6 10.6 3.6v7.9H3V4.6Zm0 8.1h7.6v7.8L3 19.4v-6.7Zm8.9-9.3L21.5 2v9.5h-9.6V3.4Zm0 9.3h9.6V22l-9.6-1.4v-7.9Z",
  },
];

export const COMPONENTS = [
  {
    name: "The engine",
    kind: "Always running",
    body: "Runs your commands and remembers everything about them. It starts with your first window and keeps going after the last one closes.",
  },
  {
    name: "The terminal app",
    kind: "A real window",
    body: "Tabs, split panes, themes, and a sidebar for the work in front of you. Open it when you want a window; close it whenever you like.",
  },
  {
    name: "The command line",
    kind: "One small binary",
    body: "The same shell, with no window at all. Opens instantly, works over SSH, and shows the same jobs as the app.",
  },
];

export const FEATURES = [
  {
    title: "Jobs that outlive windows",
    body: "Send work to the background and close the window on it. Come back in an hour, from any window, and pick it up where it was.",
  },
  {
    title: "Pause and resume anything",
    body: "Suspend a long command, let something else through, then bring it back to the foreground. Nothing is lost in between.",
  },
  {
    title: "One shell, two front doors",
    body: "Start something in the terminal app and check on it from the command line, or the other way around. There is only ever one shell.",
  },
  {
    title: "Branches side by side",
    body: "The sidebar lists every checkout of your repo with its branch and whether it has unsaved work. Click one to open it in a tab.",
  },
  {
    title: "Tabs and split panes",
    body: "Lay a window out however the task wants. Closing a pane closes a view of your work, never the work itself.",
  },
  {
    title: "Yours to configure",
    body: "Themes that switch without the layout jumping, and every keyboard shortcut editable in preferences.",
  },
];

export const STACK = [
  { name: "Elixir", body: "For the engine — a language built for programs that stay up for months." },
  { name: "Go", body: "For both front ends. Cold start you cannot feel." },
  { name: "Wails", body: "A native window, no bundled browser inside it." },
  { name: "xterm.js", body: "The terminal you actually read and type in." },
];

export const LIMITS = [
  {
    title: "Full-screen programs are next",
    body: "Editors and viewers that take over the whole terminal do not draw correctly yet. Everything else runs today.",
  },
  {
    title: "Job control is typed, for now",
    body: "You pause and resume work by name rather than with a keyboard shortcut. The shortcut is coming.",
  },
];
