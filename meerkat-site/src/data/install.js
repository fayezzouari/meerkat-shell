const FALLBACK_HOST = "meerkat.com";
const CONFIGURED = typeof __MEERKAT_SITE_URL__ === "string" ? __MEERKAT_SITE_URL__ : "";

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
