const FALLBACK_HOST = "meerkat.fayez-zouari.tn";
const CONFIGURED = typeof __MEERKAT_SITE_URL__ === "string" ? __MEERKAT_SITE_URL__ : "";

// Baked in by vite.config.js from the repo's VERSION file.
export const VERSION = typeof __MEERKAT_VERSION__ === "string" ? __MEERKAT_VERSION__ : "";

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

// Every asset a release must carry: what install.sh downloads for each platform,
// whether or not the page offers it as a file. The release workflow's verify job
// checks the release against this list, so a build leg that silently produced
// nothing fails the build rather than the visitor's install.
export const RELEASE_ASSETS = [
  "meerkat-darwin-arm64.tar.gz",
  "meerkat-darwin-amd64.tar.gz",
  "meerkat-linux-amd64.tar.gz",
];
