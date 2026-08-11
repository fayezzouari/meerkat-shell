#!/usr/bin/env bash
# Launch the Meerkat desktop app (meerkat-app), building it first if needed.
#
# meerkat-app spawns meerkat-daemon automatically on startup if nothing is
# listening on $MEERKAT_SOCK (see meerkat-app/daemonclient), so this script
# does not start the daemon itself.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/meerkat-app"
DAEMON_DIR="$SCRIPT_DIR/meerkat-daemon"
APP_BUNDLE="$APP_DIR/build/bin/meerkat-app.app"
APP_BINARY="$APP_DIR/build/bin/meerkat-app"

SOCK_PATH="${MEERKAT_SOCK:-$HOME/.meerkat/meerkat.sock}"
LOG_PATH="$(dirname "$SOCK_PATH")/daemon.log"

if ! command -v wails >/dev/null 2>&1; then
  echo "error: 'wails' CLI not found on PATH." >&2
  echo "Install it with: go install github.com/wailsapp/wails/v2/cmd/wails@latest" >&2
  exit 1
fi

# meerkat-app's daemonclient spawns the daemon with `sh -c "mix run
# --no-halt"` in $MEERKAT_DIR (defaults to "."), which is the wrong
# directory when the app is launched via `open` (e.g. cwd = $HOME).
# Start the daemon here, from the correct directory, so the app just
# connects to the already-listening socket instead of trying to spawn it.
# Whether something is actually accepting connections on the socket.
#
# Testing for the *file* (-S) is not enough: a unix socket's inode outlives
# the process that bound it, so a daemon that was killed (or crashed)
# leaves the path behind looking exactly like a healthy one. This script
# would then report "already running", start nothing, and the app would sit
# at a blank window failing to connect — with the only clue buried in the
# daemon log. Connecting for real is the only way to tell the two apart.
daemon_is_listening() {
  [[ -S "$SOCK_PATH" ]] || return 1
  python3 - "$SOCK_PATH" <<'PY' 2>/dev/null
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(2)
try:
    s.connect(sys.argv[1])
except OSError:
    sys.exit(1)
finally:
    s.close()
PY
}

if ! daemon_is_listening; then
  # Clear a stale socket first — the daemon cannot bind over an existing
  # path, so leaving it would make the restart fail for a second reason.
  if [[ -S "$SOCK_PATH" ]]; then
    echo "Found a stale socket at $SOCK_PATH (nothing listening) — removing it."
    rm -f "$SOCK_PATH"
  fi

  echo "Starting meerkat-daemon..."
  mkdir -p "$(dirname "$SOCK_PATH")"
  ( cd "$DAEMON_DIR" && MEERKAT_SOCK="$SOCK_PATH" nohup mix run --no-halt >>"$LOG_PATH" 2>&1 & )

  deadline=$((SECONDS + 15))
  until daemon_is_listening || [[ $SECONDS -ge $deadline ]]; do
    sleep 0.5
  done

  if ! daemon_is_listening; then
    echo "error: meerkat-daemon did not come up within 15s (check $LOG_PATH)" >&2
    exit 1
  fi
  echo "meerkat-daemon is up."
else
  echo "meerkat-daemon already running (socket found at $SOCK_PATH)."
fi

cd "$APP_DIR"

# Always rebuild: Wails embeds the frontend (and Go bindings) into the
# binary at build time, so a stale build/bin/ silently ignores any
# uncommitted/local changes to frontend/ or the Go sources.
echo "Building meerkat-app..."
wails build

echo "Launching meerkat-app..."
if [[ "$(uname)" == "Darwin" && -d "$APP_BUNDLE" ]]; then
  open "$APP_BUNDLE"
elif [[ -x "$APP_BINARY" ]]; then
  "$APP_BINARY"
else
  echo "error: could not find a built app to launch." >&2
  exit 1
fi
