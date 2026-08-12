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

## Before this goes live

- `meerkat.com/install.sh` is a placeholder. The page says so in two places
  (under the hero command and in the closing one) — remove both notes once a
  real installer exists.
- The type faces load from Google Fonts. Self-host them if the page needs to
  work offline.
