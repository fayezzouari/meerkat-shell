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
same job table, because the state never lived in the client.

## Installing a build

```
curl -fsSL https://meerkat.fayez-zouari.tn/install.sh | sh
```

That installs into `~/.meerkat` and leaves you with `meerkat` (the shell),
`meerkat-app` (the window), and `meerkat-engine` (start/stop/status) in
`~/.meerkat/bin`. See [`meerkat-site/README.md`](meerkat-site/README.md) for the
layout it writes and how to uninstall. macOS and Linux only — on Windows, build
from source as described above.

Or take a file instead. On macOS the release carries a `.dmg`; drag Meerkat to
Applications and its first launch offers to write the same `~/.meerkat/bin`
wrappers, so the window and the terminal command end up on one engine either
way. That works because the bundle carries the engine and the command line
inside `Contents/Resources` — a disk image hands over one thing, so that thing
has to be complete. On Linux the tarball ships `install.sh` inside it, and an
unpacked release installs itself with no network:

```
tar -xzf meerkat-linux-amd64.tar.gz -C meerkat && ./meerkat/install.sh
```

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
`darwin-amd64` and `linux-amd64` on their own runners and uploads each tarball —
plus, on macOS, a `.dmg` — with a `.sha256` beside it. Nothing to remember and
nothing to keep in sync — the version lives in `VERSION` and the tag is derived
from it.

Signing the disk image is the one thing that needs setting up outside the repo.
macOS refuses code that arrives with a browser's quarantine flag unless it is
signed and notarized, which the curl install sidesteps only because `tar` does
not set that flag. Set these repository secrets and the macOS runners do the
rest; leave them unset and the `.dmg` still builds, unsigned, and will not open
after a download:

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
fine for checking the layout, not for handing to anyone. See
[`scripts/package-dmg.sh`](scripts/package-dmg.sh) for the full set of variables.

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
