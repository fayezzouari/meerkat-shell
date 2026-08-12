#!/bin/sh
# Meerkat installer.
#
#   curl -fsSL https://meerkat.com/install.sh | sh
#
# Downloading from somewhere else (a local dev server, a staging host) means
# saying so, since a piped script cannot see the URL it was fetched from:
#
#   curl -fsSL http://localhost:5273/install.sh | MEERKAT_BASE_URL=http://localhost:5273 sh
#
# Environment:
#   MEERKAT_BASE_URL   where to fetch the release from (default https://meerkat.com)
#   MEERKAT_PREFIX     where to install it (default $HOME/.meerkat)
#
# Flags (after `sh -s --`):
#   --base URL, --prefix DIR, --no-verify, --uninstall
set -eu

DEFAULT_BASE_URL="https://meerkat.com"
BASE_URL="${MEERKAT_BASE_URL:-$DEFAULT_BASE_URL}"
PREFIX="${MEERKAT_PREFIX:-$HOME/.meerkat}"
VERIFY=1
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base)      BASE_URL="${2:?--base needs a URL}"; shift 2 ;;
    --prefix)    PREFIX="${2:?--prefix needs a directory}"; shift 2 ;;
    --no-verify) VERIFY=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help)
      sed -n '2,18p' "$0" 2>/dev/null || echo "see https://meerkat.com/install.sh"
      exit 0 ;;
    *) echo "error: unknown option '$1'" >&2; exit 2 ;;
  esac
done

BASE_URL="${BASE_URL%/}"
BIN_DIR="$PREFIX/bin"
VERSIONS_DIR="$PREFIX/versions"
CURRENT="$PREFIX/current"

# ── output ───────────────────────────────────────────────────────────

if [ -t 1 ]; then B=$(printf '\033[1m'); D=$(printf '\033[2m'); R=$(printf '\033[0m'); else B=; D=; R=; fi

say()  { printf '%s\n' "$1"; }
step() { printf '%s==>%s %s\n' "$B" "$R" "$1"; }
die()  { printf 'error: %s\n' "$1" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# ── uninstall ────────────────────────────────────────────────────────

if [ "$UNINSTALL" -eq 1 ]; then
  step "Removing Meerkat from $PREFIX"
  if [ -x "$CURRENT/engine/bin/meerkat_daemon" ]; then
    "$CURRENT/engine/bin/meerkat_daemon" stop >/dev/null 2>&1 || true
  fi
  # Test -L before -d: the app in ~/Applications is a symlink into the versions
  # directory, and by now that target is already gone, so -d is false.
  if [ -L "$HOME/Applications/Meerkat.app" ] || [ -d "$HOME/Applications/Meerkat.app" ]; then
    rm -rf "$HOME/Applications/Meerkat.app"
  fi
  rm -rf "$BIN_DIR" "$VERSIONS_DIR" "$CURRENT"
  say "Removed. Your socket and logs in $PREFIX were left alone."
  exit 0
fi

# ── platform ─────────────────────────────────────────────────────────

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux)  OS=linux ;;
  *) die "unsupported system '$(uname -s)'. Meerkat runs on macOS and Linux; on Windows, build from source." ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=amd64 ;;
  *) die "unsupported architecture '$(uname -m)'" ;;
esac

ASSET="meerkat-${OS}-${ARCH}.tar.gz"
ASSET_URL="$BASE_URL/downloads/latest/$ASSET"
SUMS_URL="$BASE_URL/downloads/latest/SHA256SUMS"

have tar || die "tar is required but not installed"

if have curl; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif have wget; then
  fetch() { wget -qO "$2" "$1"; }
else
  die "curl or wget is required"
fi

if have shasum; then
  sum256() { shasum -a 256 "$1" | cut -d' ' -f1; }
elif have sha256sum; then
  sum256() { sha256sum "$1" | cut -d' ' -f1; }
else
  sum256() { echo ""; }
fi

# ── download ─────────────────────────────────────────────────────────

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

step "Downloading $ASSET"
say "${D}from $ASSET_URL$R"
fetch "$ASSET_URL" "$TMP/$ASSET" || die "could not download $ASSET_URL
Is there a build for $OS/$ARCH at that address?"

if [ "$VERIFY" -eq 1 ]; then
  if fetch "$SUMS_URL" "$TMP/SHA256SUMS" 2>/dev/null; then
    want="$(grep "$ASSET" "$TMP/SHA256SUMS" | cut -d' ' -f1 | head -1)"
    got="$(sum256 "$TMP/$ASSET")"
    if [ -z "$got" ]; then
      say "${D}No sha256 tool found — skipping checksum.$R"
    elif [ -z "$want" ]; then
      say "${D}No checksum listed for $ASSET — skipping.$R"
    elif [ "$want" != "$got" ]; then
      die "checksum mismatch for $ASSET
  expected $want
  got      $got
Refusing to install. Re-run to download again, or pass --no-verify to skip."
    else
      say "Checksum verified."
    fi
  else
    say "${D}No SHA256SUMS published — skipping checksum.$R"
  fi
fi

step "Unpacking"
mkdir -p "$TMP/unpacked"
tar -xzf "$TMP/$ASSET" -C "$TMP/unpacked"
[ -x "$TMP/unpacked/meerkat-cli" ] || die "the archive is missing meerkat-cli — it may be corrupt"

VERSION="$(cat "$TMP/unpacked/VERSION" 2>/dev/null || echo unknown)"
TARGET="$VERSIONS_DIR/$VERSION"

# ── install ──────────────────────────────────────────────────────────

step "Installing $VERSION into $PREFIX"
mkdir -p "$VERSIONS_DIR" "$BIN_DIR"

# Replace an existing copy of this version rather than merging into it, so a
# file dropped from a later build cannot linger.
rm -rf "$TARGET"
mv "$TMP/unpacked" "$TARGET"

# `current` is what the wrappers point at, so upgrading is one symlink swap.
rm -rf "$CURRENT"
ln -s "$TARGET" "$CURRENT"

ENGINE_REL="\$ROOT/engine/bin/meerkat_daemon"

# The command line. It brings the engine up itself rather than leaning on the
# client's own spawn-and-wait: a first cold start reads the whole release off
# disk and can take longer than the client is willing to wait. MEERKAT_START_CMD
# still points at the installed engine, as a fallback for later reconnects.
cat > "$BIN_DIR/meerkat" <<EOF
#!/bin/sh
# Generated by the Meerkat installer.
set -eu
ROOT="$CURRENT"
MEERKAT_START_CMD="$ENGINE_REL daemon"
export MEERKAT_START_CMD
"$BIN_DIR/meerkat-engine" start >/dev/null
exec "\$ROOT/meerkat-cli" "\$@"
EOF

# The engine, for when you want to start or stop it by hand.
cat > "$BIN_DIR/meerkat-engine" <<EOF
#!/bin/sh
# Generated by the Meerkat installer. Starts, stops, or reports the engine.
set -eu
ROOT="$CURRENT"
ENGINE="$ENGINE_REL"
# Matches the default the command line and the app use, so all three agree on
# where to meet without anyone having to set MEERKAT_SOCK.
SOCK="\${MEERKAT_SOCK:-\$HOME/.meerkat/meerkat.sock}"
export MEERKAT_SOCK="\$SOCK"

running() { "\$ENGINE" pid >/dev/null 2>&1; }

case "\${1:-status}" in
  start)
    if running; then echo "Already running."; exit 0; fi
    # The OS refuses to bind a unix socket past ~104 characters, and the error
    # it gives back on its own says nothing about length.
    if [ \${#SOCK} -gt 100 ]; then
      echo "error: MEERKAT_SOCK is \${#SOCK} characters; the limit is about 100." >&2
      echo "Point it somewhere shorter, e.g. /tmp/meerkat.sock" >&2
      exit 1
    fi
    # A socket file outlives the process that bound it, so a dead engine leaves
    # a path the next one cannot bind.
    [ -S "\$SOCK" ] && rm -f "\$SOCK"
    mkdir -p "\$(dirname "\$SOCK")"
    "\$ENGINE" daemon
    i=0
    while [ \$i -lt 30 ]; do
      running && { echo "Engine started."; exit 0; }
      i=\$((i + 1)); sleep 0.5
    done
    echo "error: the engine did not come up. See \$(dirname "\$SOCK")/daemon.log" >&2
    exit 1 ;;
  stop)
    running || { echo "Not running."; exit 0; }
    "\$ENGINE" stop && echo "Engine stopped." ;;
  restart) "\$0" stop; "\$0" start ;;
  status)  running && echo "Running. Socket: \$SOCK" || echo "Not running." ;;
  *) echo "usage: meerkat-engine [start|stop|restart|status]" >&2; exit 2 ;;
esac
EOF

chmod +x "$BIN_DIR/meerkat" "$BIN_DIR/meerkat-engine"

# The windowed app, when the archive carries one. Launching a macOS bundle with
# `open` gives it no environment, so the engine has to be up beforehand — the
# wrapper starts it rather than letting the app guess how to.
APP_INSTALLED=0
if [ -d "$TARGET/Meerkat.app" ]; then
  cat > "$BIN_DIR/meerkat-app" <<EOF
#!/bin/sh
# Generated by the Meerkat installer.
set -eu
"$BIN_DIR/meerkat-engine" start >/dev/null
exec open -a "$CURRENT/Meerkat.app" "\$@"
EOF
  chmod +x "$BIN_DIR/meerkat-app"
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Meerkat.app"
  ln -s "$CURRENT/Meerkat.app" "$HOME/Applications/Meerkat.app"
  APP_INSTALLED=1
elif [ -x "$TARGET/meerkat-app" ]; then
  cat > "$BIN_DIR/meerkat-app" <<EOF
#!/bin/sh
# Generated by the Meerkat installer.
set -eu
"$BIN_DIR/meerkat-engine" start >/dev/null
exec "$CURRENT/meerkat-app" "\$@"
EOF
  chmod +x "$BIN_DIR/meerkat-app"
  APP_INSTALLED=1
fi

# ── what to do next ──────────────────────────────────────────────────

say ""
say "${B}Meerkat $VERSION is installed.$R"
say ""

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    say "Add it to your PATH, then open a new shell:"
    say ""
    say "  ${B}echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc$R"
    say ""
    ;;
esac

say "Then:"
say "  ${B}meerkat${R}                 open the shell in this terminal"
if [ "$APP_INSTALLED" -eq 1 ]; then
  say "  ${B}meerkat-app${R}             open the windowed terminal"
  [ "$OS" = darwin ] && say "  ${D}also in ~/Applications as Meerkat.app$R"
fi
say "  ${B}meerkat-engine status${R}   see whether the engine is running"
say ""
say "${D}The engine starts on its own the first time you need it, and keeps"
say "running after you close every window. Stop it with: meerkat-engine stop$R"
