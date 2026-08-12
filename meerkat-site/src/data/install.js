// The install command the page shows is the one that works from wherever the
// page is being served. The server bakes its own address into install.sh as it
// serves it (see the plugin in vite.config.js), so the command is the same
// shape everywhere — only the host changes.

const PRODUCTION_HOST = "meerkat.com";

export function installCommand(origin = window.location.origin) {
  let host = PRODUCTION_HOST;
  try {
    const url = new URL(origin);
    const local =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".local");
    // Production is shown bare, without scheme or port, because that is how
    // people will type and remember it.
    host = local ? `${url.origin}` : PRODUCTION_HOST;
  } catch {
    // Fall through to the production host.
  }
  return `curl -fsSL ${host}/install.sh | sh`;
}

export function isLocalInstall(origin = window.location.origin) {
  return !installCommand(origin).includes(PRODUCTION_HOST);
}
