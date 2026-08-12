// One segment of the cable that runs from the terminal window, through the
// ground, and into the engine's job list. The three segments are separate
// elements because they live in three different stacking contexts, but they
// share an x offset (--rail-x) so they read as one line.
//
// It carries traffic only while a window is open: with the window closed the
// surface segment goes dark and the pulses stop, while the segments below ground
// keep theirs. That is the demo's whole point, drawn instead of captioned.
export default function Rail({ where, live, active }) {
  return (
    <div
      className={`rail rail--${where}`}
      data-live={live}
      data-active={active}
      aria-hidden="true"
    >
      <span className="rail-line" />
      {active && <span className="rail-pulse" />}
      {where === "burrow" && <span className="rail-plug" />}
    </div>
  );
}
