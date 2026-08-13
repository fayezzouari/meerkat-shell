import { useEffect, useRef, useState } from "react";

// The branch: one stem from the bottom edge of the terminal window to the top
// edge of the engine's job list, crossing the soil line between them. Leaves
// above ground, rootlets below — the same plant, in two media.
//
// It is measured rather than hand-drawn. The two boxes it joins sit in different
// sections of the page, so nothing about the distance between them is known up
// front: a passive effect reads both rectangles, builds the curve, and re-runs on
// resize. That is the job connector libraries do (LeaderLine, react-xarrows);
// with a single pair of endpoints it is a few lines.
//
// Sprigs are placed by walking the rendered path with getPointAtLength and taken
// off its tangent for their angle, so nothing drifts off the curve when the curve
// changes. Whether a sprig is a leaf or a rootlet is decided by which side of the
// soil line it landed on. Growth and sap both ride stroke-dashoffset.
//   https://css-tricks.com/svg-line-animation-works/
//   https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/getPointAtLength

// Where along the stem sprigs sit, and which side each takes. The first takes the
// outer side: an early sprig on the inner side would sit on top of the window.
const SPRIGS = [
  { t: 0.12, side: 1, scale: 1.15 },
  { t: 0.24, side: -1, scale: 1 },
  { t: 0.36, side: 1, scale: 0.88 },
  { t: 0.47, side: -1, scale: 1.05 },
  { t: 0.58, side: 1, scale: 0.8 },
  { t: 0.69, side: -1, scale: 0.9 },
  { t: 0.8, side: 1, scale: 0.72 },
  { t: 0.9, side: -1, scale: 0.62 },
];

// A leaf: a lens on a short twig. A rootlet: a bare tapering hair.
const LEAF_D = "M5.4 0 C 9 -4.4, 16 -3.4, 19 0 C 16 3.4, 9 4.4, 5.4 0";
const TWIG_D = "M0 0 L 5.4 0";
const ROOT_D = "M0 0 C 4.5 1.8, 8 1.4, 11.5 4";

const PAD = 40; // slack either side of the curve, so leaves are never clipped

export default function Branch({ pageRef, windowRef, panelRef, groundRef, live, active }) {
  const pathRef = useRef(null);
  const [geometry, setGeometry] = useState(null);
  const [sprigs, setSprigs] = useState([]);

  // Counts the windows that have opened. It goes into each sprig's key, so a new
  // window remounts them and the unfurl animation plays again — the leaves grow
  // back rather than reappearing.
  const [openings, setOpenings] = useState(0);
  useEffect(() => {
    if (active) setOpenings((n) => n + 1);
  }, [active]);

  // A passive effect, not a layout effect: React attaches an ancestor's ref
  // during the same commit phase that runs layout effects, walking children
  // first, so in a layout effect here those refs would still be null.
  useEffect(() => {
    const page = pageRef.current;
    const windowEl = windowRef.current;
    const panel = panelRef.current;
    if (!page || !windowEl || !panel) return undefined;

    const measure = () => {
      const pageBox = page.getBoundingClientRect();
      const win = windowEl.getBoundingClientRect();
      const jobs = panel.getBoundingClientRect();
      const ground = groundRef.current?.getBoundingClientRect();

      // Out of the window's underside, over toward its right; into the panel's
      // top edge, a little right of its centre.
      const fromX = win.left - pageBox.left + win.width * 0.78;
      const fromY = win.bottom - pageBox.top;
      const toX = jobs.left - pageBox.left + jobs.width * 0.62;
      const toY = jobs.top - pageBox.top;
      if (toY - fromY < 40) return; // stacked narrow layouts: nothing to join

      const left = Math.min(fromX, toX) - PAD;
      const top = fromY;
      const width = Math.abs(toX - fromX) + PAD * 2;
      const height = toY - fromY;

      const ax = fromX - left;
      const tx = toX - left;
      const ty = height;

      // Three cubics through two waypoints, each nudged to the opposite side of
      // the straight line between the ends: a stem that grew, rather than an arc
      // struck with a compass. A single curve over a span this long reads as a
      // diagonal.
      const drift = ax - tx;
      const p1 = { x: ax - drift * 0.34 + 20, y: ty * 0.34 };
      const p2 = { x: ax - drift * 0.68 - 18, y: ty * 0.68 };
      const d =
        `M ${ax} 0` +
        ` C ${ax + 12} 26, ${p1.x + 32} ${p1.y - 40}, ${p1.x} ${p1.y}` +
        ` C ${p1.x - 34} ${p1.y + 36}, ${p2.x + 30} ${p2.y - 34}, ${p2.x} ${p2.y}` +
        ` C ${p2.x - 26} ${p2.y + 32}, ${tx + 16} ${ty - 44}, ${tx} ${ty}`;

      // Where the soil line falls inside this box: the crest sits about a third
      // of the way down the ground band.
      const crestY = ground ? ground.top - pageBox.top + ground.height * 0.33 - top : height;
      const crest = Math.min(0.98, Math.max(0.02, crestY / height));

      setGeometry({ left, top, width, height, d, ax, tx, crest, crestY });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    observer.observe(windowEl);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [groundRef, pageRef, panelRef, windowRef]);

  // Place the sprigs once the path is in the DOM, and let the soil line decide
  // what each one is.
  useEffect(() => {
    const path = pathRef.current;
    if (!path?.getPointAtLength || !geometry) return;

    const total = path.getTotalLength();
    if (!total) return;

    setSprigs(
      SPRIGS.map((sprig) => {
        const at = total * sprig.t;
        const point = path.getPointAtLength(at);
        const before = path.getPointAtLength(Math.max(0, at - 4));
        const after = path.getPointAtLength(Math.min(total, at + 4));
        const tangent = (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI;
        return {
          ...sprig,
          x: point.x,
          y: point.y,
          angle: tangent + sprig.side * 62,
          kind: point.y < geometry.crestY ? "leaf" : "root",
          total,
        };
      }),
    );
  }, [geometry]);

  if (!geometry) return null;

  const length = sprigs[0]?.total ?? geometry.height * 1.4;

  return (
    <div
      className="branch"
      data-live={live}
      data-active={active}
      aria-hidden="true"
      style={{
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
        "--len": length,
        "--sap-end": -length,
      }}
    >
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        width={geometry.width}
        height={geometry.height}
      >
        <defs>
          {/* Bark in the daylight, root colour under the soil. The stops read CSS
              variables, so state can still recolour the stem. */}
          <linearGradient id="branchAcrossSoil" x1="0" y1="0" x2="0" y2="1">
            <stop offset={Math.max(0, geometry.crest - 0.02)} stopColor="var(--stem-top)" />
            <stop offset={Math.min(1, geometry.crest + 0.02)} stopColor="var(--stem-bottom)" />
          </linearGradient>
        </defs>
        <path
          ref={pathRef}
          className="branch-stem"
          d={geometry.d}
          fill="none"
          stroke="url(#branchAcrossSoil)"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        {/* The same curve again, dashed short, sliding along it: sap on the move. */}
        {active && (
          <path className="branch-flow" d={geometry.d} fill="none" strokeWidth="2.7" strokeLinecap="round" />
        )}
        {/* A bud where the stem leaves the window, so the join looks deliberate. */}
        <circle className="branch-bud" cx={geometry.ax} cy="1.5" r="3" />
        <g className="branch-sprigs">
          {/* Three nested groups because a CSS `transform` replaces the SVG
              transform attribute outright rather than composing with it: the
              outer group places the sprig, the middle one carries state (a leaf
              drying out), the inner one is free to animate. */}
          {sprigs.map((sprig, i) => (
            // Placement, fall, angle, state, animation — one transform each,
            // because a CSS transform replaces an SVG transform attribute rather
            // than composing with it. The fall sits above the rotation so a leaf
            // drops straight down instead of along the direction it points.
            <g key={`${i}-${openings}`} transform={`translate(${sprig.x} ${sprig.y})`}>
              <g
                className={`sprig-fall${sprig.kind === "leaf" ? " is-leaf" : ""}`}
                style={{ "--i": i, "--fall-x": `${i % 2 ? 7 : -5}px` }}
              >
                <g transform={`rotate(${sprig.angle}) scale(${sprig.scale})`}>
                  <g className={`sprig-state sprig--${sprig.kind}`}>
                    <g className="sprig" style={{ "--i": i }}>
                      {sprig.kind === "leaf" ? (
                        <>
                          <path className="twig" d={TWIG_D} fill="none" strokeWidth="1.2" />
                          <path className="leaf" d={LEAF_D} />
                        </>
                      ) : (
                        <path className="root" d={ROOT_D} fill="none" strokeWidth="1.1" strokeLinecap="round" />
                      )}
                    </g>
                  </g>
                </g>
              </g>
            </g>
          ))}
        </g>
        {/* Where the root meets the engine. */}
        <circle className="branch-tip" cx={geometry.tx} cy={geometry.height} r="3.4" />
      </svg>
    </div>
  );
}
