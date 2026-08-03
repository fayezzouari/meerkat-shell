# meerkat-daemon

The daemon half of Meerkat, a custom BEAM-based shell. Owns parsing,
execution, job control, and (later) durable scheduling. Talks to
clients over a Unix domain socket — it has no idea it's being used as
a shell "backend" vs. anything else that could speak the same
protocol.

## Run it (dev)

```
mix deps.get
# needs a C++ toolchain (g++/make) to build erlexec's port program —
# already present on most dev machines; on a fresh box: apt install
# build-essential, or brew install with Xcode CLI tools on macOS.
mix run --no-halt
```

Listens on `$MEERKAT_SOCK`, defaulting to `~/.meerkat/meerkat.sock`.

**If you hit `"Not allowed to run as root without setting effective
user"` on startup:** you're running as root. `config/config.exs`
auto-detects this and passes erlexec the options it needs to allow it
— see the comment there. This shouldn't come up on a normal dev
machine; it exists because the daemon was built and tested inside a
root-only sandbox.

## Protocol

Newline-delimited plain text over the socket (`packet: :line`):

```
client -> daemon:  one line of shell input
daemon -> client:  "O:<text>"  one stdout line
                    "E:<text>"  one stderr line
                    "D:<cwd>"   sent on connect, and again if cwd changed
                    "X:<code>"  terminates this command's response
```

## What's implemented

**Parsing** (`lib/meerkat_daemon/parser.ex`) — quoted strings, `|`
pipelines, trailing `&` for background jobs. Still close to POSIX on
purpose; a structured `|>` pipe operator is the planned next syntax
addition.

**Execution** (`lib/meerkat_daemon/evaluator.ex`) — runs pipelines via
[erlexec](https://github.com/saleyn/erlexec), not a plain `Port`.
This is what makes real job control possible: a `Port` can only be
closed (roughly a SIGKILL), it can't suspend, resume, or gracefully
terminate a process — erlexec exposes the actual OS pid so real
signals work. stdout and stderr are also genuinely separate streams
now (Phase 1's `Port` version had to merge them).

**Job control** — real, not simulated:
- `cmd &` — run in the background, prints `[id] started in background`
- `jobs` — lists id / status (`running` / `stopped` / `done`) / command
- `stop <id>` — suspends a running job (SIGSTOP) — our stand-in for
  Ctrl+Z until a client does raw keystroke capture (see
  `meerkat-client`'s roadmap)
- `bg <id>` — resumes a stopped job in the background (SIGCONT)
- `fg <id>` — resumes if stopped, then blocks the calling session
  until the job finishes, then replays its captured output. Does
  **not** re-route the job's *live* output to the `fg`'ing session —
  see the moduledoc in `evaluator.ex` for why, and what real
  reattachment would take.
- `kill <id>` — terminates a job (`:exec.stop/1`: SIGTERM, escalating
  to SIGKILL after a timeout if the process ignores it). One honest
  quirk: erlexec reports jobs stopped this way as exit code 0
  (`:normal`) rather than a signal-coded status — that's erlexec's own
  behavior for `:exec.stop`, not something this layer papers over.

All of the above was run against a live daemon while building it —
background + stop + bg + kill + a blocking `fg` that measured ~2004ms
waiting on an actual 2-second job — not just written and assumed
correct.

**Job table** (`lib/meerkat_daemon/job_manager.ex`) — ETS-backed.
Also holds a per-job `waiters` list so `fg` can block the caller with
a plain `receive`/`send` instead of polling.

**Connections** — one `MeerkatDaemon.Connection` GenServer per client,
under a `DynamicSupervisor` — a crashed connection doesn't touch the
daemon or other sessions.

## What's next (in order)

1. **Real Ctrl+Z from the client** — `stop`/`bg`/`fg` above are typed
   commands; the natural next step is `meerkat-client` (or
   `meerkat-app`) capturing raw keystrokes and translating
   `Ctrl+Z`/`Ctrl+C` into the equivalent daemon calls automatically,
   the way a real shell does.
2. **pty allocation** — erlexec supports a `:pty` option we're not
   using yet. Without it, programs that check "is this a real
   terminal" (`ls --color`, `git diff`, `vim`, `htop`, `less`) behave
   as if piped to a file. This is also what `meerkat-app`'s xterm.js
   frontend is fully ready to render the moment the daemon produces
   real ANSI output.
3. **Structured pipes** — a `|>` token whose stages receive decoded
   Elixir terms (JSON/CSV/lines) instead of raw bytes.
4. **Durable scheduling** — `every`/`at` blocks backed by
   [Oban](https://github.com/oban-bg/oban) (+ SQLite adapter) for jobs
   that should survive the daemon restarting — distinct from the
   in-memory job table above, which is for the current session's
   fg/bg jobs.
5. **Idle CPU tuning** — BEAM's scheduler busy-waits by default,
   showing up as nonzero CPU on an otherwise-idle daemon. Set
   `+sbwt none +sbwtdcpu none +sbwtdio none` as VM flags once you're
   running a release instead of `mix run`.
