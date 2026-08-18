import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveSection } from "../hooks/useActiveSection.js";
import CommandPalette from "./CommandPalette.jsx";
import InstallMenu from "./InstallMenu.jsx";

// The nav reads as a path bar, because that is what a shell puts where a website
// puts links. One caret slides to whichever section you are actually in, so the
// bar answers "where am I" the way a prompt does — by showing the path, not by
// tinting a word.
const LINKS = [
  { id: "how", label: "how" },
  { id: "features", label: "features" },
  { id: "stack", label: "stack" },
];

const IDS = LINKS.map((link) => link.id);

export default function Nav({ groundRef }) {
  const active = useActiveSection(IDS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [underground, setUnderground] = useState(false);
  const [caret, setCaret] = useState(null);
  const listRef = useRef(null);
  const linkRefs = useRef(new Map());

  // The bar is fixed, so it passes over both regions of the page. It has to
  // change coat at the crossing or it becomes dark ink on dark soil.
  useEffect(() => {
    const onScroll = () => {
      const ground = groundRef?.current?.getBoundingClientRect();
      // Half the bar's height: the switch lands when the crest reaches the
      // middle of the bar rather than when it touches the top edge.
      setUnderground(Boolean(ground) && ground.top <= 30);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [groundRef]);

  // Measured, not computed: the caret sits after the active path in a
  // proportional-width bar, and only the rendered box knows where that is.
  const place = useCallback(() => {
    const list = listRef.current;
    const el = active ? linkRefs.current.get(active) : null;
    if (!list || !el) {
      setCaret(null);
      return;
    }
    const listBox = list.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    setCaret({ x: box.right - listBox.left, y: box.top - listBox.top, h: box.height });
  }, [active]);

  useEffect(() => {
    place();
    // The bar is laid out in a web font that arrives after first paint; every
    // path shifts when it lands, and the caret has to follow.
    document.fonts?.ready.then(place);
    const observer = new ResizeObserver(place);
    if (listRef.current) observer.observe(listRef.current);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [place]);

  // ⌘K on a Mac, Ctrl+K everywhere else. Also `/`, the way a pager opens search
  // — but never while the reader is typing into something.
  useEffect(() => {
    const onKey = (event) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));

      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shortcut = useMemo(
    () => (/Mac/.test(navigator.platform ?? navigator.userAgent) ? "⌘K" : "^K"),
    [],
  );

  return (
    <>
      <header className="nav" data-underground={underground}>
        <div className="nav-inner container">
          <a className="brand" href="#top">
            <img src="/meerkat-logo.png" alt="" width="20" height="35" />
            <span>Meerkat</span>
          </a>

          <nav className="nav-paths" aria-label="Sections" ref={listRef}>
            {LINKS.map(({ id, label }) => (
              <a
                key={id}
                href={`#${id}`}
                className="nav-path"
                aria-current={active === id ? "true" : undefined}
                ref={(el) => {
                  if (el) linkRefs.current.set(id, el);
                  else linkRefs.current.delete(id);
                }}
              >
                <span className="nav-path-dir">~/</span>{label}
              </a>
            ))}
            {/* One caret for the whole bar, parked after the active path. Hidden
                rather than unmounted so it slides between paths instead of
                blinking out of one and into the next. */}
            <span
              className="nav-caret"
              aria-hidden="true"
              data-on={Boolean(caret)}
              style={
                caret
                  ? { transform: `translate(${caret.x}px, ${caret.y}px)`, height: caret.h }
                  : undefined
              }
            />
          </nav>

          <button
            type="button"
            className="nav-k"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open the jump-to palette"
          >
            <kbd>{shortcut}</kbd>
          </button>

          <InstallMenu />
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
