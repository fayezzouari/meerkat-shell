# meerkat-app

The GUI half of Meerkat — a real windowed terminal, built with
[Wails](https://wails.io) (Go backend) and
[xterm.js](https://xtermjs.org) (terminal rendering). Talks to
`meerkat-daemon` exactly the way `meerkat-client` does — same socket,
same protocol, same lazy-spawn behavior — just rendered in a window
instead of your existing terminal app.

## One-time setup (per machine)

**1. Install the Wails CLI:**
```
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

**2. Install platform prerequisites**, then confirm with `wails doctor`:

- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `libgtk-3-dev` and `libwebkit2gtk-4.0-dev` (or `4.1` on
  newer distros) — e.g. `sudo apt install libgtk-3-dev libwebkit2gtk-4.0-dev`
- **Windows**: nothing extra — WebView2 ships with Windows 10/11

```
wails doctor
```

**3. Pull Go dependencies:**
```
go mod tidy
```

This step needs normal internet access to `proxy.golang.org` — it
can't run inside a sandboxed/offline environment, which is why this
project ships uncompiled.

## Run it in dev mode

```
wails dev
```

Opens a window with hot-reload on the frontend files. Connects to
`meerkat-daemon` on startup the same way `meerkat-client` does —
spawns it if nothing's listening on `$MEERKAT_SOCK`.

## Build a real app

```
wails build
```

Produces a native binary/bundle in `build/bin/`:
- macOS → `meerkat-app.app` (drag to `/Applications`)
- Windows → `meerkat-app.exe`
- Linux → a standalone binary (or add `-nsis`/`-platform linux/amd64`
  flags for packaged installers — see Wails' build docs)

## How it's wired

```
frontend (xterm.js)  <—events/methods—>  app.go  <—socket—>  meerkat-daemon
```

- `daemonclient/` — the connect-or-spawn logic, extracted verbatim from
  `meerkat-client` so both frontends behave identically. Compiles and
  runs independent of Wails (verified against a live daemon before
  this GUI layer was built on top).
- `app.go` — `SendLine(line string)` is exposed to JS as
  `window.go.main.App.SendLine(...)`; every raw line the daemon sends
  back gets forwarded to JS as a `daemon:line` event.
- `frontend/main.js` — the only place that interprets the `O:`/`E:`/
  `D:`/`X:` protocol prefixes, and the only place doing local line
  editing (echo, backspace) — see the comment in that file for why:
  the daemon doesn't allocate a pty yet, so there's no kernel tty
  driver doing that for us.
- `frontend/js/backdrop.js` — the default window background: the
  Meerkat mark rendered as an animated Ben-Day dot field by
  [Benday](https://github.com/KacemMathlouthi/benday). Benday ships as
  a shadcn/React registry item, but this frontend has no React or
  bundler, so `scripts/vendor-benday.sh` pulls its framework-agnostic
  core (bake, renderer, presets) into `frontend/vendor/benday/` as
  plain ES modules and `backdrop.js` stands in for the `<Benday>`
  wrapper. Re-run the script to bump it.

## Worktrees

The sidebar (default `Cmd+B`) lists the git worktrees of whatever repo
the focused pane is sitting in, alongside its panes and the daemon's
job table. Each row shows the worktree's directory name, its branch, and
a dot when it has uncommitted work; clicking one opens a new tab there.

- **`+`** creates a worktree. Type a branch name: an existing local
  branch is checked out, anything else is created as a new branch off
  `HEAD`. The new worktree opens in a tab immediately.
- **`×`** removes one (never the repo's main working tree). Removing a
  worktree with uncommitted changes asks first, then passes `--force`.

New worktrees land in `../<repo>-worktrees/<name>` by default — a
sibling of the repo, so they never appear as untracked paths inside the
working tree. Preferences → Worktrees changes that: `<repo>` expands to
the repository's name and relative paths resolve against its root, so
`.meerkat/worktrees` keeps them inside the repo instead.

A fresh worktree is a bare checkout: no `.env`, no `node_modules`, nothing
git ignores. Preferences → Worktrees → *Worktree setup script* is a shell
script that runs inside every worktree the sidebar creates, right after
`git worktree add`, with your login shell's environment (so `npm`, `direnv`
and anything from `~/.local/bin` resolve). It sees:

| Variable | Value |
| --- | --- |
| `MEERKAT_WORKTREE` | the new checkout, also the working directory |
| `MEERKAT_WORKTREE_NAME` | its directory name |
| `MEERKAT_REPO_ROOT` | the main working tree, where the `.env` you want to copy lives |
| `MEERKAT_BRANCH` | the branch checked out in it |

A repository can ship its own hook too: `.meerkat/worktree-setup.sh` at the
repo root runs after the preference script, so a team commits the setup once
and every clone gets it. Output from both lands in the sidebar; a failing
script is reported there rather than failing the creation — the worktree
exists by then and still opens.

```sh
cp "$MEERKAT_REPO_ROOT/.env" .env
npm install
```

`worktree.go` shells out to the real `git` binary for all of this
(`worktree list --porcelain`, `add`, `remove`) rather than
reimplementing the plumbing, and every invocation runs with
`GIT_TERMINAL_PROMPT=0` under a timeout — the sidebar polls on a 2s
timer, and a git call that blocks on input would wedge it.

## Source control (beta)

`Cmd+G` (or View → Toggle Source Control) opens a panel on the right of the
terminals showing the checkout the focused pane is in — the linked worktree's
own index and history when the pane is inside one, not the main repo's.

- **Branch row** — branch, `↑n` to push and `↓n` to pull against the
  upstream, or *no upstream* when none is set.
- **Pull / Push / Sync / Stash** — plain `git pull`, `git push` (with `-u`
  to the first remote on a branch that has no upstream), pull-then-push, and
  `git stash push --include-untracked`. Git's own transcript appears under the
  buttons; a remote that wants credentials fails with git's message, because
  nothing here ever prompts (`GIT_TERMINAL_PROMPT=0`).
- **Commit** — a message box and a button, live once something is staged.
  `Cmd+Enter` in the box commits.
- **Conflicts / Staged / Changes / Untracked** — one row per path with its
  status letter. `+` stages, `−` unstages, `↺` discards (after a confirm:
  `git restore` for a tracked file, delete for an untracked one; ignored files
  are never touched). Click a row to unfold its diff. *list* shows flat paths,
  *tree* nests them by folder.
- **Commits** — the last 40 on `HEAD`. A filled dot and a `local` tag mark
  commits the upstream does not have yet, so what is and is not pushed is
  visible without `git log origin/main..`.
- **Stashes** — each with *pop* and *drop*.

It is a mirror, refreshed every 3 seconds and after each of its own actions;
the terminal beside it is authoritative. States it does not manage — an
interactive rebase, submodules, sparse checkouts — are shown as best it can,
with a banner naming any merge, rebase, cherry-pick or revert in progress.
`vcs.go` is the Go side: `git status --porcelain=v2 --branch -z` for the tree,
`git log` plus `git rev-list <upstream>..HEAD` for the pushed/local split, and
one git invocation per button.

## Known limitation: no pty yet

Programs that check "is this a real terminal" — `ls --color`,
`git diff`, `vim`, `htop`, `less` — will render as if piped to a file,
because `meerkat-daemon` currently execs commands through a plain
`Port`, not a pty. xterm.js is fully capable of rendering full ANSI
output the moment the daemon produces it; this is purely a
daemon-side gap. It's the same `erlexec` swap already on
`meerkat-daemon`'s roadmap for job control (`Ctrl+Z`/`bg`/`fg`) —
worth doing sooner if you're using this GUI daily, since `erlexec`'s
pty option solves both at once.

## What's next

- Wire real pty support once the daemon side has it — swap local line
  editing for raw keystroke-per-keystroke forwarding, dropping the
  "fake cooked mode" in `main.js`.
- Multiple tabs/panes — each would be its own `daemonclient.Client`
  talking to the same daemon, since jobs/state already live
  server-side, not in this window.
- App icon, macOS menu bar, "quit on last window closed" behavior —
  all standard `wails.json` / `options.App` config once the core loop
  feels right.
