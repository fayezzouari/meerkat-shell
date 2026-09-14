// The two globals Wails injects into the page (see wailsjs/, generated at
// build time and not checked in): the bound Go methods and the runtime.
interface Window {
  go: { main: { App: Record<string, (...args: any[]) => Promise<any>> } };
  runtime: Record<string, (...args: any[]) => any>;
}

// xterm.js and its fit addon, loaded as classic scripts from vendor/xterm
// (see index.html), so they arrive as globals rather than imports.
declare const Terminal: any;
declare const FitAddon: { FitAddon: new () => any };
