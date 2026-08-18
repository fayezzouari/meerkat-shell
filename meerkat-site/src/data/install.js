const FALLBACK_HOST = "meerkat.fayez-zouari.tn";
const CONFIGURED = typeof __MEERKAT_SITE_URL__ === "string" ? __MEERKAT_SITE_URL__ : "";

// Both baked in by vite.config.js: the version from the repo's VERSION file, and
// the same download directory install.sh defaults to. The page and the installer
// must agree on where the assets live, or the two install paths ship different
// builds.
export const VERSION = typeof __MEERKAT_VERSION__ === "string" ? __MEERKAT_VERSION__ : "";
const DOWNLOADS = typeof __MEERKAT_DOWNLOAD_URL__ === "string" ? __MEERKAT_DOWNLOAD_URL__ : "";

export const REPO_URL = "https://github.com/fayezzouari/meerkat-shell";

function isLocal(origin) {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

export function installHost(origin = window.location.origin) {
  if (isLocal(origin)) return origin;
  if (CONFIGURED) {
    try {
      return new URL(CONFIGURED).host;
    } catch {
      return CONFIGURED;
    }
  }
  try {
    return new URL(origin).host;
  } catch {
    return FALLBACK_HOST;
  }
}

export function installCommand(origin = window.location.origin) {
  return `curl -fsSL ${installHost(origin)}/install.sh | sh`;
}

export function isLocalInstall(origin = window.location.origin) {
  return isLocal(origin);
}

/* ── downloadable files ─────────────────────────────────────────────
   The curl line is one path to a working install; a downloaded file is the
   other. They install the same three pieces — engine, terminal app, command
   line — so which one someone picks is a matter of taste, not of what they end
   up with. */

// A release directory, matching install.sh's DEFAULT_DOWNLOAD_URL. Locally the
// site serves its own builds, so a dev download is the build just made.
export function downloadsBase(origin = window.location.origin) {
  if (isLocal(origin)) return `${origin.replace(/\/+$/, "")}/downloads/latest`;
  return DOWNLOADS || `${REPO_URL}/releases/latest/download`;
}

export function downloadUrl(file, origin = window.location.origin) {
  return `${downloadsBase(origin)}/${file}`;
}

// What we can actually tell from a browser. Architecture is deliberately absent:
// a browser cannot distinguish Apple silicon from Intel reliably (an Intel build
// under Rosetta and a native arm64 build report the same thing), so macOS offers
// both rather than guessing wrong and handing someone a binary that will not run.
export function detectOs(ua = navigator.userAgent, platform = navigator.platform ?? "") {
  const s = `${ua} ${platform}`;
  // iOS/iPadOS before macOS: recent iPads claim to be a Mac in the UA string.
  if (/iPhone|iPad|iPod/.test(s)) return "ios";
  if (/Android/.test(s)) return "android";
  if (/Mac/.test(s)) return "macos";
  if (/Win/.test(s)) return "windows";
  if (/Linux|X11|CrOS/.test(s)) return "linux";
  return "unknown";
}

export const DOWNLOAD_FILES = {
  macos: [
    {
      id: "darwin-arm64",
      file: "Meerkat-darwin-arm64.dmg",
      label: "Download for Mac",
      detail: "Apple silicon · .dmg",
    },
    {
      id: "darwin-amd64",
      file: "Meerkat-darwin-amd64.dmg",
      label: "Download for Intel Mac",
      detail: "Intel · .dmg",
    },
  ],
  linux: [
    {
      id: "linux-amd64",
      file: "meerkat-linux-amd64.tar.gz",
      label: "Download for Linux",
      detail: "x86-64 · .tar.gz",
    },
  ],
};

// Every OS the page has something to offer, in the order the chooser shows them.
export const DOWNLOAD_PLATFORMS = ["macos", "linux"];
