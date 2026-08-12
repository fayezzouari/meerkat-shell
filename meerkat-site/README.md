# meerkat-site

The landing page for Meerkat. React + Vite, no other runtime dependencies.

```
npm install
npm run dev      # http://localhost:5273
npm run build    # static output in dist/
npm run preview  # serve the build
```

## The idea behind the layout

The page is a cross-section of ground. Above the line is daylight — the hero,
the install command, the OS list — and below it is the burrow, where the engine
lives. There is exactly one crossing, and it carries the whole argument: a
terminal window sits above the line, the engine's job list sits below it, and
you can start a job, close the window, and open a new one to find the job still
counting.

That demo's state lives in `src/hooks/useDaemonDemo.js`, above both views that
render it — `CrossingDemo` (the window) and `DaemonPanel` (the engine). Closing
the window clears the transcript without touching the job, which is the product's
own claim expressed as component structure.

## Motion

The cable (`components/Rail.jsx`) is the one loud element: three segments that
share an x offset (`--rail-x`) so they read as a single line from the window,
through the ground, into the job list. It lights when a job exists, carries
pulses while a window is open, and goes dark and dotted above ground once the
window closes — the demo's claim, drawn rather than captioned.

Everything else is quiet: a hero that arrives in reading order, sections that
rise once on entry (`hooks/useReveal.js`), grain on both regions, and hover
detail on the cards. All of it collapses under `prefers-reduced-motion`, and the
reveal hook adds its class immediately in that case so nothing depends on an
animation that never plays.

The typed line is driven by elapsed time on a schedule of jittered keystroke
times, read on each animation frame — not by one timer per character. A chain of
timers stalls mid-word whenever the browser throttles or freezes the tab (switch
away and back, and you would return to half a word); reading the clock means the
line catches up to where it belongs as soon as frames resume. Output lines are
not animated at all, because a shell prints rather than fades.

Three traps worth remembering if you edit the animations:

- A step is guarded by a ref, not by the `busy` state. Several clicks can land in
  one tick, before React re-renders, and two overlapping runs of a step corrupt
  the transcript. A click during a step fast-forwards it instead of queueing. an animation with
`fill-mode: both` keeps overriding the properties it animated, which is why
`.window` uses `backwards` (otherwise `[data-closed]` can never hide it); and an
IntersectionObserver threshold above 0 can never fire for a section taller than
the viewport.

## Layout of the source

```
index.html                 fonts + mount point
src/main.jsx               entry
src/App.jsx                page order, and the one shared piece of state
src/styles.css             all styles; palette and type scale as tokens at the top
src/data/content.js        every string on the page
src/components/            one file per section
src/hooks/                 the demo state machine, and copy-to-clipboard
public/meerkat-logo.png    shared with meerkat-app
```

Copy lives in `src/data/content.js` so editing what the page says never means
editing layout. Backticked spans in those strings render as inline code via
`components/Rich.jsx`.

## The installer

`public/install.sh` is served at `<host>/install.sh`, and downloads a release
tarball from `<host>/downloads/latest/`. Build that tarball first:

```
../scripts/release.sh          # or --no-app to skip the GUI
npm run dev
curl -fsSL http://localhost:5273/install.sh | sh
```

That works without naming the host twice because the server rewrites the
script's `DEFAULT_BASE_URL` to its own address as it serves it — see the
`meerkat-installer-base-url` plugin in `vite.config.js`. A production build
leaves the script's own default (`meerkat.com`) unless `MEERKAT_SITE_URL` is set:

```
MEERKAT_SITE_URL=https://meerkat.com npm run build
```

`MEERKAT_BASE_URL` still overrides the baked-in value at install time, which is
what to reach for when serving the page and the downloads from different hosts.

What lands where, with `~/.meerkat` as the default prefix:

```
~/.meerkat/versions/<version>/   the release: engine/, meerkat-cli, Meerkat.app
~/.meerkat/current               symlink to the active version
~/.meerkat/bin/meerkat           the shell
~/.meerkat/bin/meerkat-app       the windowed terminal
~/.meerkat/bin/meerkat-engine    start | stop | restart | status
~/Applications/Meerkat.app       symlink, macOS only
```

Both wrappers start the engine before connecting, rather than relying on the
client's own spawn — a first cold start reads the whole OTP release off disk and
can outlast the client's wait. Checksums are verified against
`downloads/latest/SHA256SUMS`; a mismatch aborts. `sh -s -- --uninstall` reverses
it, leaving your socket and logs alone.

Releases are built per platform (the engine ships a compiled OTP release and
erlexec builds a C++ port program), so a Linux tarball has to be built on Linux.
`public/downloads/` is gitignored — regenerate it, don't commit it.

## Before this goes live

- `meerkat.com` does not serve anything yet, so the command the page shows for
  non-local hosts is still a placeholder and says so. Publishing means putting
  `dist/` and a built `downloads/latest/` behind that domain, and building with
  `MEERKAT_SITE_URL` set; the installer itself needs no change.
- The type faces load from Google Fonts. Self-host them if the page needs to
  work offline.
