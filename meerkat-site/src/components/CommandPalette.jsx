import { useEffect, useMemo, useRef, useState } from "react";
import {
  DOWNLOAD_FILES,
  REPO_URL,
  detectOs,
  downloadUrl,
  installCommand,
} from "../data/install.js";

// ⌘K. A shell's own way of getting somewhere is to type where you want to go, so
// the page offers the same thing rather than a menu.
//
// Deliberately small: it navigates, it copies the install line, it hands over a
// file. It is not a search engine over the page's prose, which would be a
// promise the index cannot keep.

function useItems() {
  return useMemo(() => {
    const command = installCommand();
    const os = detectOs();

    const go = (id, name, hint) => ({
      id: `go:${id}`,
      name,
      hint,
      kind: "Go to",
      run: () => document.getElementById(id)?.scrollIntoView({ block: "start" }),
    });

    const items = [
      go("install", "install", "the one-line install"),
      go("how", "how", "what the engine actually is"),
      go("features", "features", "what you get"),
      go("stack", "stack", "what it is built with"),
      go("limits", "limits", "what does not work yet"),
      {
        id: "copy",
        name: "copy install command",
        hint: command,
        kind: "Run",
        run: () => navigator.clipboard?.writeText(command),
      },
    ];

    // The reader's own platform first — the others are still reachable by
    // typing, they just are not the thing sitting under the cursor.
    const platforms = os === "linux" ? ["linux", "macos"] : ["macos", "linux"];
    for (const platform of platforms) {
      for (const asset of DOWNLOAD_FILES[platform] ?? []) {
        items.push({
          id: `dl:${asset.id}`,
          name: asset.label.toLowerCase(),
          hint: asset.detail,
          kind: "Download",
          run: () => {
            window.location.href = downloadUrl(asset.file);
          },
        });
      }
    }

    items.push({
      id: "source",
      name: "view the source",
      hint: "github.com/fayezzouari/meerkat-shell",
      kind: "Open",
      run: () => window.open(REPO_URL, "_blank", "noopener,noreferrer"),
    });

    return items;
  }, []);
}

// Subsequence match, the way a fuzzy finder works: "dlm" finds "download for
// mac". Falls back to matching the hint so "dmg" finds it too.
function matches(item, query) {
  if (!query) return true;
  const needle = query.toLowerCase().replace(/\s+/g, "");
  const test = (haystack) => {
    let i = 0;
    for (const ch of haystack.toLowerCase()) {
      if (ch === needle[i]) i += 1;
      if (i === needle.length) return true;
    }
    return false;
  };
  return test(item.name) || item.hint.toLowerCase().includes(needle);
}

export default function CommandPalette({ open, onClose }) {
  const all = useItems();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Where focus was before the palette took it, so closing puts it back rather
  // than dropping the reader at the top of the document.
  const restoreTo = useRef(null);

  const results = useMemo(() => all.filter((item) => matches(item, query)), [all, query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return undefined;
    restoreTo.current = document.activeElement;
    setQuery("");
    setCursor(0);
    inputRef.current?.focus();

    // A dialog over the page should not let the page scroll behind it.
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus();
    };
  }, [open]);

  // Keep the highlighted row on screen when the arrow keys walk past the edge.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-cursor="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  if (!open) return null;

  const choose = (item) => {
    onClose();
    // After the close, so the scroll target is not the overlay we just removed
    // and so focus restoration has already happened.
    requestAnimationFrame(() => item.run());
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => (results.length ? (c + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = results[cursor];
      if (item) choose(item);
    }
  };

  return (
    <div
      className="palette-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        onKeyDown={onKeyDown}
      >
        <div className="palette-input">
          <span className="palette-prompt" aria-hidden="true">meerkat ~ ❯</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="jump to, or download…"
            aria-label="Jump to, or download"
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        <ul className="palette-list" ref={listRef} role="listbox" aria-label="Results">
          {results.map((item, i) => (
            // The li is presentational: a listbox's options have to be its own
            // children, and the list item would otherwise sit between them.
            <li key={item.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                data-cursor={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(item)}
              >
                <span className="palette-kind">{item.kind}</span>
                <span className="palette-name">{item.name}</span>
                <span className="palette-hint">{item.hint}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="palette-empty">No match.</li>}
        </ul>

        <p className="palette-foot">
          <kbd>↑</kbd><kbd>↓</kbd> move &nbsp;·&nbsp; <kbd>↵</kbd> pick &nbsp;·&nbsp; <kbd>esc</kbd> close
        </p>
      </div>
    </div>
  );
}
