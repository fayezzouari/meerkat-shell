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

The branch (`components/Branch.jsx`) is the one loud element: one stem from the
underside of the terminal window to the top edge of the engine's job list,
crossing the soil line between them — leaves above ground, rootlets below. It
carries sap while a window is open. Close the window and it lets go: the leaves
dry, detach, and drop away in sequence, the bud at the window fades, and the stem
is left bare — while the root below keeps its glow and the clock keeps counting.
Open a new window and they grow back. That is the demo's claim drawn rather than
captioned.

The fall drops straight down whatever angle a leaf hangs at, which is why each
sprig has a placement group, a fall group, an angle group, a state group and an
animation group: one transform each. Regrowth works by counting windows opened
and putting that count in each sprig's key, so a new window remounts them and
the unfurl animation plays again instead of the leaves snapping back.

It is measured, not hand-drawn. The two boxes it joins live in different sections,
so it is a page-level overlay (last in `App.jsx`, above both) rather than a child
of either: a passive effect reads both rectangles plus the ground band, builds the
curve, and re-runs on resize. Leaves are placed with `getPointAtLength` and angled
off the tangent, so nothing drifts off the curve when the curve changes, and each
sprig becomes a leaf or a rootlet depending on which side of the soil line it
landed on. The stroke is a gradient whose stops switch at that same crossing.

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

Five traps worth remembering if you edit this:

- A CSS `transform` replaces an SVG `transform` attribute rather than composing
  with it. Anything animated on top of a placed sprig needs its own nested `<g>`,
  or every sprig snaps back to the origin.
- A child's layout effect runs *before* an ancestor's ref is attached — React
  walks children first in the same commit phase. Measuring a parent box belongs
  in a passive effect, where refs already exist.
- A step is guarded by a ref, not by the `busy` state. Several clicks can land in
  one tick, before React re-renders, and two overlapping runs of a step corrupt
  the transcript. A click during a step fast-forwards it instead of queueing.
- An animation with `fill-mode: both` keeps overriding the properties it
  animated, which is why `.window` uses `backwards` — otherwise `[data-closed]`
  can never hide it again.
- An IntersectionObserver threshold above 0 can never fire for a section taller
  than the viewport, so the reveal hook uses 0.

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
tarball from its own `DEFAULT_DOWNLOAD_URL` — the GitHub Release, not this site.
The two are deliberately separate: the page is a static deploy that rebuilds on
every push, while the tarballs have to be built on the platform they target and
are published as release assets. Nothing about deploying the page ships a binary.

Locally that split disappears. Build a tarball and the dev server serves it, and
rewrites the script's `DEFAULT_DOWNLOAD_URL` to its own address on the way out —
see the `meerkat-installer-download-url` plugin in `vite.config.js` — so a real
install over localhost needs no environment variables:

```
../scripts/release.sh          # or --no-app to skip the GUI
npm run dev
curl -fsSL http://localhost:5273/install.sh | sh
```

`MEERKAT_DOWNLOAD_URL` and `MEERKAT_BASE_URL` override the baked-in value at
install time — the first names an asset directory, the second a site serving one
under `/downloads/latest`.

## Deploying

The page is a static Vite build with no server side, so any static host works;
`vercel.json` sets the root's build command, output directory, and a shell
content type for `/install.sh`. On Vercel, point the project's root directory at
`meerkat-site`.

Two build-time variables, neither required:

```
MEERKAT_SITE_URL=https://meerkat.fayez-zouari.tn   the domain the page tells people to curl
MEERKAT_DOWNLOAD_URL=https://…/download            where install.sh fetches tarballs from
```

`MEERKAT_SITE_URL` is the one that matters. Without it the page falls back to
`VERCEL_PROJECT_PRODUCTION_URL`, then to whatever origin it is being viewed at,
so a preview deploy prints a command that points at that preview. Set it once the
real domain is live so every deploy names it instead. `MEERKAT_DOWNLOAD_URL` only
needs setting if the assets move off GitHub Releases.

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
can outlast the client's wait. Checksums are verified against the `.sha256`
published beside each tarball; a mismatch aborts. `sh -s -- --uninstall`
reverses it, leaving your socket and logs alone.

Releases are built per platform (the engine ships a compiled OTP release and
erlexec builds a C++ port program), so a Linux tarball has to be built on Linux.
That is what `.github/workflows/release.yml` does on a `v*` tag — see the root
README. `public/downloads/` is gitignored: it is the local-serving path only, so
regenerate it, don't commit it.

## Before this goes live

- `meerkat.fayez-zouari.tn` has no DNS record yet, though the apex already points
  at Vercel. Add the subdomain to the project, then set `MEERKAT_SITE_URL` to it;
  until then, leave the variable unset and the page names its own origin.
- The Linux tarball is built on Ubuntu 24.04, so its OTP release wants that
  glibc or newer. Older distributions need a build of their own.
- The macOS app is unsigned and unnotarized, so a first launch needs a
  right-click → Open. Signing it means an Apple Developer ID in the workflow.
- The type faces load from Google Fonts. Self-host them if the page needs to
  work offline.
