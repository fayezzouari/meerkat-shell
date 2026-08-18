import { useEffect, useRef, useState } from "react";
import {
  DOWNLOAD_FILES,
  DOWNLOAD_PLATFORMS,
  detectOs,
  downloadUrl,
  installCommand,
} from "../data/install.js";
import { useCopy } from "../hooks/useCopy.js";

const OS_NAMES = { macos: "macOS", linux: "Linux", windows: "Windows" };

// The nav's install control: a button that takes you to the install section, and
// a caret that opens every way of getting Meerkat without scrolling there.
//
// Split rather than a plain link because there are now two install paths — a
// command and a file — and a single button would have to pick one for everyone.
export default function InstallMenu() {
  const [open, setOpen] = useState(false);
  const [os, setOs] = useState("unknown");
  const wrapRef = useRef(null);
  const firstItemRef = useRef(null);
  const toggleRef = useRef(null);
  const { copy, label: copyLabel } = useCopy(installCommand());

  // In an effect, not during render: the userAgent is not available while the
  // module is being evaluated on a prerender, and reading it during render would
  // make the first paint disagree with the second.
  useEffect(() => setOs(detectOs()), []);

  useEffect(() => {
    if (!open) return undefined;
    firstItemRef.current?.focus();

    const onPointer = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    // `pointerdown`, not `click`: a click on a link inside the menu should still
    // reach the link, and closing on mousedown outside feels immediate.
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The reader's own platform first, the rest still listed — a laptop is not
  // always the machine the download is for.
  const platforms = [
    ...DOWNLOAD_PLATFORMS.filter((p) => p === os),
    ...DOWNLOAD_PLATFORMS.filter((p) => p !== os),
  ];

  return (
    <div className="install-menu" ref={wrapRef}>
      <a className="install-menu-go" href="#install">Install</a>
      <button
        type="button"
        className="install-menu-toggle"
        ref={toggleRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Other ways to install"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 10 6" aria-hidden="true" width="10" height="6">
          <path d="M1 1 L5 5 L9 1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>

      {open && (
        <div className="install-pop" role="menu">
          <button
            type="button"
            role="menuitem"
            ref={firstItemRef}
            className="install-pop-row"
            onClick={copy}
          >
            <span className="install-pop-name">{copyLabel} the install command</span>
            <span className="install-pop-detail">curl · macOS and Linux</span>
          </button>

          {platforms.map((platform) =>
            DOWNLOAD_FILES[platform].map((asset) => (
              <a
                key={asset.id}
                role="menuitem"
                className="install-pop-row"
                href={downloadUrl(asset.file)}
              >
                <span className="install-pop-name">{asset.label}</span>
                <span className="install-pop-detail">{asset.detail}</span>
              </a>
            )),
          )}

          {os === "windows" && (
            <p className="install-pop-note">
              No Windows build yet — {OS_NAMES.windows} means building from source.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
