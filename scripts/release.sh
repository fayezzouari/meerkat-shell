#!/usr/bin/env bash
# Builds Meerkat for the machine it runs on and packages it two ways: the tarball
# install.sh downloads, and — on macOS — a .dmg for people who would rather have
# a file than a pipe into sh. Output lands in
# meerkat-site/public/downloads/latest/, which is exactly where the site serves
# it from, so `npm run dev` in meerkat-site is enough to make a real install work
# over localhost.
#
# Both paths install the same three pieces. The difference is only who does the
# unpacking: install.sh, or the Finder plus the app's own first run.
#
# Cross-compiling is out of scope: the daemon ships a compiled OTP release and
# erlexec builds a C++ port program, so each platform's tarball has to be built
# on that platform.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
OUT_DIR="$ROOT/meerkat-site/public/downloads/latest"

BUILD_APP=1
BUILD_DMG=1
PUBLISH=0
for arg in "$@"; do
  case "$arg" in
    --no-app)  BUILD_APP=0 ;;
    --no-dmg)  BUILD_DMG=0 ;;
    --publish) PUBLISH=1 ;;
    -h|--help)
      echo "usage: scripts/release.sh [--no-app] [--no-dmg] [--publish]"
      echo "  --no-app   skip the GUI (needs the wails CLI); ships the daemon and CLI only"
      echo "  --no-dmg   skip the macOS disk image; ships the tarball only"
      echo "  --publish  upload the assets to the GitHub Release for v$VERSION (needs gh)"
      echo
      echo "Signing the .dmg (see scripts/package-dmg.sh):"
      echo "  MEERKAT_SIGN_IDENTITY, MEERKAT_NOTARY_PROFILE"
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
    # The bundle carries its own engine and command line. This is what makes a
    # .dmg possible at all — a disk image hands over one thing, so that thing
    # has to be complete — and it costs the tarball nothing, because the app
    # prefers what is inside it and the wrappers keep working either way.
    step "Putting the engine inside the bundle"
    mkdir -p "$STAGE/Meerkat.app/Contents/Resources"
    cp -R "$STAGE/engine" "$STAGE/Meerkat.app/Contents/Resources/engine"
    cp "$STAGE/meerkat-cli" "$STAGE/Meerkat.app/Contents/Resources/meerkat-cli"
  else
    cp "$ROOT/meerkat-app/build/bin/meerkat-app" "$STAGE/meerkat-app"
  fi
else
  echo "Skipping the terminal app (--no-app)."
  BUILD_DMG=0
fi

echo "$VERSION" > "$STAGE/VERSION"

# The installer travels with the tarball, so an unpacked archive can install
# itself. That is what makes "download a file" a real option on Linux, where
# there is no .dmg — see install.sh's --from.
cp "$ROOT/meerkat-site/public/install.sh" "$STAGE/install.sh"
chmod +x "$STAGE/install.sh"

step "Packaging $ASSET"
mkdir -p "$OUT_DIR"
tar -czf "$OUT_DIR/$ASSET" -C "$STAGE" .

ASSETS=("$OUT_DIR/$ASSET")

if [[ "$OS" == "darwin" && $BUILD_DMG -eq 1 ]]; then
  DMG_ASSET="Meerkat-${OS}-${ARCH}.dmg"
  "$ROOT/scripts/package-dmg.sh" "$STAGE/Meerkat.app" "$OUT_DIR/$DMG_ASSET" "$VERSION"
  ASSETS+=("$OUT_DIR/$DMG_ASSET")
fi

step "Checksums"
for path in "${ASSETS[@]}"; do
  name="$(basename "$path")"
  if command -v shasum >/dev/null 2>&1; then
    ( cd "$OUT_DIR" && shasum -a 256 "$name" > "$name.sha256" )
  else
    ( cd "$OUT_DIR" && sha256sum "$name" > "$name.sha256" )
  fi
  printf '  %s  (%s)\n' "$name" "$(du -h "$path" | cut -f1)"
done

if [[ $PUBLISH -eq 1 ]]; then
  TAG="v$VERSION"
  step "Publishing to $TAG"
  if ! gh release view "$TAG" >/dev/null 2>&1; then
    gh release create "$TAG" --title "Meerkat $VERSION" --generate-notes
  fi
  UPLOAD=()
  for path in "${ASSETS[@]}"; do UPLOAD+=("$path" "$path.sha256"); done
  gh release upload "$TAG" --clobber "${UPLOAD[@]}"
  echo "Uploaded ${#ASSETS[@]} asset(s) to $TAG."
  echo
  echo "Install it:"
  echo "  curl -fsSL https://meerkat.fayez-zouari.tn/install.sh | sh"
else
  echo
  echo "Serve it locally, then install from it:"
  echo "  cd meerkat-site && npm run dev"
  echo "  curl -fsSL http://localhost:5273/install.sh | sh"
  echo
  echo "Or publish it to the GitHub Release: scripts/release.sh --publish"
fi
