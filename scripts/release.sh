#!/usr/bin/env bash
# Builds Meerkat for the machine it runs on and packages it as the tarball that
# install.sh downloads. Output lands in meerkat-site/public/downloads/latest/,
# which is exactly where the site serves it from — so `npm run dev` in
# meerkat-site is enough to make a real install work over localhost.
#
# Cross-compiling is out of scope: the daemon ships a compiled OTP release and
# erlexec builds a C++ port program, so each platform's tarball has to be built
# on that platform.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
OUT_DIR="$ROOT/meerkat-site/public/downloads/latest"

BUILD_APP=1
PUBLISH=0
for arg in "$@"; do
  case "$arg" in
    --no-app)  BUILD_APP=0 ;;
    --publish) PUBLISH=1 ;;
    -h|--help)
      echo "usage: scripts/release.sh [--no-app] [--publish]"
      echo "  --no-app   skip the GUI (needs the wails CLI); ships the daemon and CLI only"
      echo "  --publish  upload the tarball to the GitHub Release for v$VERSION (needs gh)"
      exit 0
      ;;
    *) echo "error: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

if [[ $PUBLISH -eq 1 ]] && ! command -v gh >/dev/null 2>&1; then
  echo "error: --publish needs the 'gh' CLI on PATH (https://cli.github.com)." >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux)  OS=linux ;;
  *) echo "error: unsupported OS '$(uname -s)' — build on macOS or Linux" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=amd64 ;;
  *) echo "error: unsupported architecture '$(uname -m)'" >&2; exit 1 ;;
esac

ASSET="meerkat-${OS}-${ARCH}.tar.gz"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step "Building the command line ($OS/$ARCH)"
( cd "$ROOT/meerkat-client" && go build -trimpath -o "$STAGE/meerkat-cli" . )

step "Building the engine (OTP release)"
(
  cd "$ROOT/meerkat-daemon"
  mix deps.get
  MIX_ENV=prod mix release --overwrite --quiet
)
cp -R "$ROOT/meerkat-daemon/_build/prod/rel/meerkat_daemon" "$STAGE/engine"

if [[ $BUILD_APP -eq 1 ]]; then
  if ! command -v wails >/dev/null 2>&1; then
    echo "error: 'wails' not on PATH. Install it, or re-run with --no-app." >&2
    echo "  go install github.com/wailsapp/wails/v2/cmd/wails@latest" >&2
    exit 1
  fi
  step "Building the terminal app"
  ( cd "$ROOT/meerkat-app" && wails build -clean ${WAILS_TAGS:+-tags "$WAILS_TAGS"} )
  if [[ "$OS" == "darwin" ]]; then
    cp -R "$ROOT/meerkat-app/build/bin/meerkat-app.app" "$STAGE/Meerkat.app"
  else
    cp "$ROOT/meerkat-app/build/bin/meerkat-app" "$STAGE/meerkat-app"
  fi
else
  echo "Skipping the terminal app (--no-app)."
fi

echo "$VERSION" > "$STAGE/VERSION"

step "Packaging $ASSET"
mkdir -p "$OUT_DIR"
tar -czf "$OUT_DIR/$ASSET" -C "$STAGE" .

if command -v shasum >/dev/null 2>&1; then
  ( cd "$OUT_DIR" && shasum -a 256 "$ASSET" > "$ASSET.sha256" )
else
  ( cd "$OUT_DIR" && sha256sum "$ASSET" > "$ASSET.sha256" )
fi

printf '\n\033[1mDone.\033[0m %s (%s)\n' "$ASSET" "$(du -h "$OUT_DIR/$ASSET" | cut -f1)"

if [[ $PUBLISH -eq 1 ]]; then
  TAG="v$VERSION"
  step "Publishing to $TAG"
  if ! gh release view "$TAG" >/dev/null 2>&1; then
    gh release create "$TAG" --title "Meerkat $VERSION" --generate-notes
  fi
  gh release upload "$TAG" --clobber "$OUT_DIR/$ASSET" "$OUT_DIR/$ASSET.sha256"
  echo "Uploaded $ASSET to $TAG."
  echo
  echo "Install it:"
  echo "  curl -fsSL https://meerkat.com/install.sh | sh"
else
  echo
  echo "Serve it locally, then install from it:"
  echo "  cd meerkat-site && npm run dev"
  echo "  curl -fsSL http://localhost:5273/install.sh | sh"
  echo
  echo "Or publish it to the GitHub Release: scripts/release.sh --publish"
fi
