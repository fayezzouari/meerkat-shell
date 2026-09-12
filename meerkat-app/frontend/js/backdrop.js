import { bakeCached } from "../vendor/benday/bake.js";
import { createRenderer } from "../vendor/benday/renderer.js";
import { DEFAULT_BACKGROUND, getSettings, onAppearanceChange } from "./appearance.js";

// The default background: the Meerkat mark rendered as an animated Ben-Day dot
// field (vendor/benday, see scripts/vendor-benday.sh). This is the vanilla-JS
// stand-in for the registry's <Benday src preset size /> component — it owns
// the canvas, the bake and the resize, and hands everything else to the
// renderer. A user-chosen wallpaper replaces it via #backdrop's CSS image.
const LOGO = "/assets/meerkat-logo.png";
const PRESET = "shimmer";
// Fraction of the window the mark may span on its tighter axis.
const SCALE = 0.4;
// Dots across the mark's longest side. The registry default (24) is sized for
// a 64px indicator; a mark a few hundred pixels tall needs finer sampling to
// read as a logo, but past ~40 the dots crowd and blur.
const GRID = 40;

let dotMap = null;

function sizeFor() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // fit: "natural" takes the width and derives height from the mark's aspect,
  // so constrain the width by whichever axis the mark hits first.
  const aspect = dotMap && dotMap.aspect > 0 ? dotMap.aspect : 1;
  return Math.max(1, Math.floor(Math.min(w, h * aspect) * SCALE));
}

export function initBackdrop() {
  const host = document.getElementById("backdrop");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  const renderer = createRenderer(canvas, {
    preset: PRESET,
    fit: "natural",
    size: sizeFor(),
    // Resolved off the canvas's computed color, which index.html binds to
    // --text, so the dots follow the theme without a subscription here.
    color: "currentColor",
    state: "thinking",
  });

  bakeCached(LOGO, { grid: GRID })
    .then((map) => {
      dotMap = map;
      renderer.update({ dotMap, size: sizeFor() });
    })
    .catch((err) => {
      // Not fatal: the backdrop simply stays empty.
      console.warn("backdrop: benday bake failed", err);
    });

  // Only the bundled default is a live canvas; a user's own image or "None"
  // hides it and stops the animation clock.
  onAppearanceChange(() => {
    const active = getSettings().backgroundImagePath === DEFAULT_BACKGROUND;
    canvas.hidden = !active;
    renderer.update({ paused: !active });
  });

  // Coalesced to one relayout per frame: each size change rebuilds the
  // display lattice, and macOS emits resize at 60Hz while dragging.
  let pending = 0;
  window.addEventListener("resize", () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      renderer.update({ size: sizeFor() });
    });
  });
}
