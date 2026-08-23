# Meerkat

Meerkat is a custom shell with its execution engine split out into a
long-lived daemon, so the parsing/job-control/scheduling logic lives in one
place and every frontend — a plain CLI, a native GUI, whatever comes next —
is just a thin client that talks to it over a socket.

The core idea: your shell state (background jobs, working directory,
running commands) shouldn't die with your terminal window. It lives in the
daemon. Frontends connect, disconnect, and reconnect around it.

```
meerkat-client (CLI)  ─┐
                        ├─  Unix socket, line protocol  ─►  meerkat-daemon (BEAM/Elixir)
meerkat-app (GUI)     ─┘
```

## Components

- **[`meerkat-daemon`](meerkat-daemon/)** — the engine. A BEAM (Elixir)
  application that owns parsing, pipeline execution, and real job control
  (`&`, `jobs`, `stop`/`bg`/`fg`, `kill`) via
  [erlexec](https://github.com/saleyn/erlexec). Durable scheduling
  (`every`/`at` blocks backed by Oban) is on the roadmap. It has no notion
  of "shell" beyond the protocol it speaks — anything that can dial its
  Unix socket and send newline-delimited text can drive it.

- **[`meerkat-client`](meerkat-client/)** — the minimal CLI frontend. A
  small Go binary that dials the daemon's socket (spawning it if nothing's
  listening), prints a prompt, and forwards each line you type. Starts
  instantly and stays that way regardless of how much heavier the daemon
  gets.

- **[`meerkat-app`](meerkat-app/)** — the GUI frontend. A real windowed
  terminal built with [Wails](https://wails.io) (Go) and
  [xterm.js](https://xtermjs.org), using the exact same connect-or-spawn
  logic and wire protocol as `meerkat-client` — just rendered in a window
  with proper terminal emulation instead of your existing terminal app.

Both frontends are interchangeable views onto the same daemon: start a
background job from the CLI, then open the GUI and run `jobs` — it's the
same job table, because the state never lived in the client. Close the pane
your dev server is running in and it keeps serving: a job holding a listening
socket outlives the window that started it, and the GUI's sidebar lists it with
the port it's on, what it's costing in memory, and a button to kill it.

## Installing a build

```
curl -fsSL https://meerkat.fayez-zouari.tn/install.sh | sh
```

That installs into `~/.meerkat` and leaves you with `meerkat` (the shell),
`meerkat-app` (the window), and `meerkat-engine` (start/stop/status) in
`~/.meerkat/bin`. See [`meerkat-site/README.md`](meerkat-site/README.md) for the
layout it writes and how to uninstall. macOS and Linux only. On Windows, run it
inside WSL2 and use the Linux build: building natively is not an option, because
the engine's job control is [erlexec](https://github.com/saleyn/erlexec), whose
port program is POSIX (`fork`/`execve`/`setsid`/`termios`) and has no Windows
target.

Or take a file instead. Every platform ships the same thing, a tarball with
`install.sh` inside it, so an unpacked release installs itself with no network.
Two commands, from Terminal:

```
mkdir -p meerkat && tar -xzf ~/Downloads/meerkat-darwin-arm64.tar.gz -C meerkat
./meerkat/install.sh
```

The `mkdir` is not optional — the archive is flat, and `tar -C` will not create
the directory it is pointed at. Swap the filename for `meerkat-darwin-amd64` on
an Intel Mac or `meerkat-linux-amd64` on Linux; nothing else changes.

Use `tar`, not a double-click. On macOS that is not a style preference: the
Finder passes the download's quarantine flag to everything it extracts, and
macOS will not launch a quarantined app Apple has not notarized. `tar` does not
set the flag, which is the same reason the curl install works.

There is no `.dmg`. A disk image is quarantined the same way, and getting one
past Gatekeeper needs a Developer ID certificate and a notarization round-trip;
[`scripts/package-dmg.sh`](scripts/package-dmg.sh) and the release workflow are
ready for it, waiting on a certificate rather than on code. The macOS tarball
carries a complete `Meerkat.app` either way, engine and command line inside
`Contents/Resources` included.

The page and the binaries are published separately. The page is a static deploy
of `meerkat-site`; the release tarballs are GitHub Release assets, because each
one has to be built on the platform it targets — the daemon ships a compiled OTP
release and erlexec builds a C++ port program, so nothing cross-compiles.
`install.sh` therefore downloads from the release rather than from whatever host
served it.

## Cutting a release

Run the `release` workflow from the Actions tab and pick what to increment:
patch, minor, major, or none. It reads `VERSION`, works out the next number,
commits the bump, tags it, opens the GitHub Release, then builds `darwin-arm64`,
`darwin-amd64` and `linux-amd64` on their own runners and uploads each tarball
with a `.sha256` beside it. A final job then checks the release against the
download page's own asset list, so a leg that silently failed to produce a file
the page offers fails the build instead of the visitor's download. Nothing to
remember and nothing to keep in sync — the version lives in `VERSION` and the tag
is derived from it.

Publishing a `.dmg` is the one thing that needs setting up outside the repo, and
the reason there isn't one yet. macOS refuses code that arrives with a browser's
quarantine flag unless it is signed and notarized, which the tarball sidesteps
only because `tar` does not set that flag. Set these repository secrets, drop the
`--no-dmg` from the workflow's `release.sh` call, and the macOS runners do the
rest. Left unset, `release.sh --publish` refuses to upload a disk image nobody
could open — `--allow-unsigned` overrides that, for a fork or a dry run:

| Secret | What it is |
| --- | --- |
| `MACOS_CERTIFICATE` | Developer ID Application `.p12`, base64-encoded |
| `MACOS_CERTIFICATE_PASSWORD` | the export password for that `.p12` |
| `MACOS_SIGN_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `MACOS_NOTARY_APPLE_ID` | the Apple ID to notarize under |
| `MACOS_NOTARY_PASSWORD` | an app-specific password for it |
| `MACOS_NOTARY_TEAM_ID` | the team the certificate belongs to |

```
gh workflow run release -f bump=minor      # 0.1.0 -> 0.2.0
gh workflow run release -f version=1.0.0   # or name it outright
```

Pushing a `v*` tag by hand runs the same workflow, minus the bump; it checks the
tag against `VERSION` and refuses if they disagree.

```
git tag v0.1.0 && git push origin v0.1.0
```

`scripts/release.sh` is what those runners call, and it works the same by hand —
`--publish` uploads to the release for the current `VERSION`, and without it the
tarball just lands in `meerkat-site/public/downloads/latest/`, where the dev
server serves it for a real install over localhost:

```
./scripts/release.sh                 # --no-app skips the GUI, --no-dmg the image
cd meerkat-site && npm run dev
curl -fsSL http://localhost:5273/install.sh | sh
```

A local `.dmg` build is unsigned unless `MEERKAT_SIGN_IDENTITY` is exported —
fine for checking the layout, not for handing to anyone, and `--publish` will not
upload it. See [`scripts/package-dmg.sh`](scripts/package-dmg.sh) for the full set
of variables.

## Protocol

Newline-delimited plain text over a Unix domain socket
(`$MEERKAT_SOCK`, defaulting to `~/.meerkat/meerkat.sock`):

```
client -> daemon:  one line of shell input
daemon -> client:  "O:<text>"  one stdout line
                    "E:<text>"  one stderr line
                    "D:<cwd>"   sent on connect, and again if cwd changed
                    "X:<code>"  terminates this command's response
```

## Getting started

Run the daemon first (see [`meerkat-daemon/README.md`](meerkat-daemon/README.md)
for prerequisites — you'll need a C++ toolchain for erlexec):

```
cd meerkat-daemon
mix deps.get
mix run --no-halt
```

Then, in another terminal, either frontend will connect to it (and will
also spawn it automatically if it isn't already running):

```
cd meerkat-client
go run .
```

or, for the GUI (see [`meerkat-app/README.md`](meerkat-app/README.md) for
one-time Wails setup):

```
cd meerkat-app
wails dev
```

## Current limitations

- **No pty allocation yet** — commands that check "is this a real
  terminal" (`ls --color`, `git diff`, `vim`, `htop`, `less`) render as if
  piped to a file, since the daemon execs through erlexec without a pty
  option enabled yet. Both frontends are ready to render full ANSI output
  the moment the daemon produces it.
- **No raw Ctrl+Z/Ctrl+C capture** — job control (`stop`/`bg`/`fg`) is
  driven by typed commands today; wiring real keystroke capture in the
  clients is the natural next step.

See each component's README for its own roadmap in more detail.
