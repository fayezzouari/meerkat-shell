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
