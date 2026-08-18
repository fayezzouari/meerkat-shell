#!/usr/bin/env bash
# Packages an already-built Meerkat.app as a signed, notarized .dmg.
#
#   scripts/package-dmg.sh <Meerkat.app> <output.dmg> [version]
#
# A .dmg hands over exactly one thing, so the bundle it carries has to be
# self-sufficient: scripts/release.sh puts the engine and the command line inside
# Contents/Resources before calling this, and the app finds them from its own
# location on disk (see daemonclient.BundledEngine).
#
# Signing is what separates a download people can open from one macOS calls
# damaged. A file fetched by a browser carries a quarantine flag, and Gatekeeper
# refuses to run unsigned, un-notarized code that has it — the curl install
# sidesteps this only because tar does not set the flag. So:
#
#   MEERKAT_SIGN_IDENTITY   "Developer ID Application: Name (TEAMID)"
#   MEERKAT_NOTARY_PROFILE  a `xcrun notarytool store-credentials` profile
#
# or, for CI, the three pieces that profile is made of:
#
#   MEERKAT_APPLE_ID, MEERKAT_APPLE_PASSWORD (app-specific), MEERKAT_TEAM_ID
#
# With none of them set it still builds a .dmg — unsigned, and honest about it.
# That is the right behaviour for a local build and the wrong one to ship.
set -euo pipefail

APP="${1:?usage: package-dmg.sh <Meerkat.app> <output.dmg> [version]}"
DMG="${2:?usage: package-dmg.sh <Meerkat.app> <output.dmg> [version]}"
VERSION="${3:-}"

[[ -d "$APP" ]] || { echo "error: no such bundle: $APP" >&2; exit 1; }
[[ "$(uname -s)" == "Darwin" ]] || { echo "error: a .dmg can only be built on macOS" >&2; exit 1; }

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$1" >&2; }

VOLUME="Meerkat${VERSION:+ $VERSION}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# ── sign ─────────────────────────────────────────────────────────────
# Deep, hardened, and with a timestamp: notarization rejects a bundle missing
# any of the three. --deep reaches the engine's own executables under
# Resources/, which are Mach-O binaries in their own right and each need a
# signature of their own.

SIGNED=0
if [[ -n "${MEERKAT_SIGN_IDENTITY:-}" ]]; then
  step "Signing the bundle"
  codesign --force --deep --timestamp \
    --options runtime \
    --sign "$MEERKAT_SIGN_IDENTITY" \
    "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
  SIGNED=1
else
  warn "MEERKAT_SIGN_IDENTITY is not set — building an unsigned .dmg."
  warn "macOS will refuse to open it after a browser download."
fi

# ── build the image ──────────────────────────────────────────────────
# A plain drag-to-install layout: the bundle, and a link to where it goes.

step "Building $(basename "$DMG")"
mkdir -p "$STAGE/volume"
cp -R "$APP" "$STAGE/volume/Meerkat.app"
ln -s /Applications "$STAGE/volume/Applications"

rm -f "$DMG"
mkdir -p "$(dirname "$DMG")"
# UDZO is the compressed read-only format every macOS since forever mounts
# without complaint. Built straight from the folder — no intermediate
# read-write image to attach, lay out, and detach, which is where the fiddly
# `hdiutil` failures live.
hdiutil create \
  -volname "$VOLUME" \
  -srcfolder "$STAGE/volume" \
  -ov -format UDZO -quiet \
  "$DMG"

if [[ $SIGNED -eq 1 ]]; then
  codesign --force --timestamp --sign "$MEERKAT_SIGN_IDENTITY" "$DMG"
fi

# ── notarize ─────────────────────────────────────────────────────────
# Apple has to see the thing before a user's Mac will run it. Stapling writes
# the ticket into the image, so the first launch works without a network.

notarize() {
  if [[ -n "${MEERKAT_NOTARY_PROFILE:-}" ]]; then
    xcrun notarytool submit "$DMG" --keychain-profile "$MEERKAT_NOTARY_PROFILE" --wait
  elif [[ -n "${MEERKAT_APPLE_ID:-}" && -n "${MEERKAT_APPLE_PASSWORD:-}" && -n "${MEERKAT_TEAM_ID:-}" ]]; then
    xcrun notarytool submit "$DMG" \
      --apple-id "$MEERKAT_APPLE_ID" \
      --password "$MEERKAT_APPLE_PASSWORD" \
      --team-id "$MEERKAT_TEAM_ID" \
      --wait
  else
    return 2
  fi
}

if [[ $SIGNED -eq 1 ]]; then
  step "Notarizing"
  if notarize; then
    xcrun stapler staple "$DMG"
    xcrun stapler validate "$DMG"
    echo "Notarized and stapled."
  else
    status=$?
    if [[ $status -eq 2 ]]; then
      warn "No notarization credentials — signed but not notarized."
      warn "Set MEERKAT_NOTARY_PROFILE, or MEERKAT_APPLE_ID + MEERKAT_APPLE_PASSWORD + MEERKAT_TEAM_ID."
    else
      # A signed-but-unnotarized .dmg is still refused on a fresh Mac, so a
      # failure here is a release that does not work, not a warning.
      echo "error: notarization failed" >&2
      exit 1
    fi
  fi
fi

printf '\n\033[1mDone.\033[0m %s (%s)\n' "$(basename "$DMG")" "$(du -h "$DMG" | cut -f1)"
