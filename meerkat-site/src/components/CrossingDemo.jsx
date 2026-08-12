// The window half of the demo: everything above the ground line. It renders
// only what the transcript holds, and holds nothing itself — the job lives in
// useDaemonDemo, one level up, shared with the daemon panel below ground.
export default function CrossingDemo({ demo }) {
  const { lines, typing, windowOpen, windowTitle, hint, step, steps, done, busy, advance, restart } = demo;
  const next = steps[step];

  return (
    <section className="crossing container" aria-labelledby="crossing-h">
      <h2 id="crossing-h" className="sr">
        Try it: start a job, close the window, open a new one
      </h2>

      <div className="window" data-closed={!windowOpen}>
        <div className="window-bar">
          <span className="dot" aria-hidden="true" />
          <span className="window-title">{windowTitle}</span>
        </div>
        <div className="window-body" role="log" aria-live="polite" aria-label="Terminal transcript">
          {lines.map((line, i) =>
            line.kind === "input" ? (
              <div key={i}>
                <span className="prompt">meerkat ~ ❯</span> {line.text}
              </div>
            ) : (
              <div key={i} className="out">{line.text}</div>
            ),
          )}
          {typing ? (
            <div>
              <span className="prompt">meerkat ~ ❯</span> {typing.text}
              <span className="cursor" />
            </div>
          ) : (
            <div>
              <span className="prompt">meerkat ~ ❯</span> <span className="cursor" />
            </div>
          )}
        </div>
      </div>

      <p className="crossing-hint">{hint}</p>

      <div className="demo-controls">
        {!done && (
          <button className="btn primary" type="button" onClick={advance} disabled={busy}>
            {next.action}
          </button>
        )}
        {done && (
          <button className="btn ghost" type="button" onClick={restart}>
            Start over
          </button>
        )}
      </div>
    </section>
  );
}
