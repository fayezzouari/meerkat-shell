// The window half of the demo: everything above the ground line. It renders only
// what the transcript holds, and holds nothing itself — the job lives in
// useDaemonDemo, one level up, shared with the engine panel below ground.
//
// The transcript sits at the bottom of the window, where a shell's prompt
// actually lives, so the prompt does not walk down the box as output arrives.
export default function CrossingDemo({ demo, windowRef }) {
  const {
    lines, typing, windowOpen, windowTitle, hint, step, steps, done, busy, advance, restart,
  } = demo;
  const next = steps[step];

  return (
    <section className="crossing" aria-labelledby="crossing-h">
      <h2 id="crossing-h" className="sr">
        Try it: start a job, close the window, open a new one
      </h2>

      <div className="window" data-closed={!windowOpen} ref={windowRef}>
        <div className="window-bar">
          <span className="dot" aria-hidden="true" />
          <span className="window-title">{windowTitle}</span>
        </div>
        <div className="window-body" role="log" aria-live="polite" aria-label="Terminal transcript">
          {lines.map((line, i) =>
            line.kind === "input" ? (
              <div className="term-line" key={i}>
                <span className="prompt">meerkat ~ ❯</span> {line.text}
              </div>
            ) : (
              <div className="term-line out" key={i}>{line.text}</div>
            ),
          )}
          <div className="term-line">
            <span className="prompt">meerkat ~ ❯</span>{" "}
            {typing?.text}
            {/* A caret holds still while keys are landing and blinks when the
                shell is waiting, which is what a real one does. */}
            <span className={`caret${typing ? " is-typing" : ""}`} />
          </div>
        </div>
      </div>

      <p className="crossing-hint" key={hint}>{hint}</p>

      <div className="demo-controls">
        {!done ? (
          // Stays clickable while a step plays: a click then fast-forwards it,
          // rather than being swallowed by a disabled button.
          <button
            className="btn primary"
            type="button"
            onClick={advance}
            aria-label={busy ? `${next.action} — skip the animation` : next.action}
          >
            {next.action}
          </button>
        ) : (
          <button className="btn ghost" type="button" onClick={restart}>
            Start over
          </button>
        )}
      </div>
    </section>
  );
}
