import { useEffect, useRef, useState } from "react";

// The link between the window above ground and the engine below it, drawn as one
// living branch rather than a wire. Three segments in three different containers,
// sharing an x offset and matching endpoints, so they read as a single stem:
//
//   surface — a branch leaving the window, leaves out to the sides
//   ground  — the stem crossing the soil line: one last leaf in the air, then rootlets
//   burrow  — root, tapering into the engine panel
//
// Sprigs are positioned by measuring the real path with getPointAtLength and
// taking the tangent for their angle, so a leaf can never drift off the curve
// when the curve is edited. Growth and flow both ride stroke-dashoffset.
//   https://css-tricks.com/svg-line-animation-works/
//   https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/getPointAtLength

const W = 80;          // viewBox width; the stem sits at x = 40
export const STEM_X = 40;

// Heights are fixed in px so each segment maps 1:1 to its viewBox — scaling a
// viewBox non-uniformly would stretch the leaves along with the curve.
const SEGMENTS = {
  surface: {
    h: 104,
    stroke: 2.1,
    // Leaves the window slightly off-centre, leans back, straightens at the soil.
    d: "M40 0 C 40 20, 27 32, 31 55 C 34 74, 47 84, 40 104",
    sprigs: [
      { t: 0.2, kind: "leaf", side: -1, scale: 1.15 },
      { t: 0.44, kind: "leaf", side: 1, scale: 1 },
      { t: 0.62, kind: "leaf", side: -1, scale: 0.82 },
      { t: 0.84, kind: "leaf", side: 1, scale: 1.08 },
    ],
  },
  ground: {
    h: 72,
    stroke: 1.9,
    d: "M40 0 C 35 14, 46 28, 40 44 C 35 56, 43 64, 40 72",
    sprigs: [
      { t: 0.12, kind: "leaf", side: 1, scale: 0.9 },
      { t: 0.58, kind: "root", side: -1, scale: 0.9 },
      { t: 0.86, kind: "root", side: 1, scale: 0.75 },
    ],
  },
  burrow: {
    h: 60,
    stroke: 1.6,
    d: "M40 0 C 45 12, 34 24, 40 40 C 43 50, 40 52, 40 60",
    sprigs: [
      { t: 0.32, kind: "root", side: 1, scale: 0.8 },
      { t: 0.7, kind: "root", side: -1, scale: 0.62 },
    ],
  },
};

// Leaf: a lens on a short twig. Root: a bare tapering hair.
const LEAF_D = "M5.4 0 C 9 -4.4, 16 -3.4, 19 0 C 16 3.4, 9 4.4, 5.4 0";
const TWIG_D = "M0 0 L 5.4 0";
const ROOT_D = "M0 0 C 4.5 1.8, 8 1.4, 11.5 4";

export default function Branch({ where, live, active }) {
  const segment = SEGMENTS[where];
  const pathRef = useRef(null);
  const [sprigs, setSprigs] = useState([]);

  useEffect(() => {
    const path = pathRef.current;
    if (!path?.getPointAtLength) return;

    const total = path.getTotalLength();
    setSprigs(
      segment.sprigs.map((sprig) => {
        const at = total * sprig.t;
        const point = path.getPointAtLength(at);
        // Tangent from a short chord around the point, clamped to the path.
        const before = path.getPointAtLength(Math.max(0, at - 3));
        const after = path.getPointAtLength(Math.min(total, at + 3));
        const tangent = (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI;
        // Off the stem, to whichever side this sprig belongs.
        const angle = tangent + sprig.side * 62;
        return { ...sprig, x: point.x, y: point.y, angle };
      }),
    );
  }, [segment]);

  return (
    <div
      className={`branch branch--${where}`}
      data-live={live}
      data-active={active}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${W} ${segment.h}`} width={W} height={segment.h}>
        <path
          ref={pathRef}
          className="branch-stem"
          d={segment.d}
          fill="none"
          strokeWidth={segment.stroke}
          strokeLinecap="round"
        />
        {/* Same curve again, dashed short, sliding along it: sap on the move. */}
        {active && (
          <path
            className="branch-flow"
            d={segment.d}
            fill="none"
            strokeWidth={segment.stroke + 0.6}
            strokeLinecap="round"
          />
        )}
        <g className="branch-sprigs">
          {/* Three nested groups because a CSS `transform` replaces the SVG
              transform attribute outright, rather than composing with it: the
              outer group places the sprig on the curve, the middle one carries
              state (a leaf drying out), the inner one is free to animate. */}
          {sprigs.map((sprig, i) => (
            <g
              key={i}
              transform={`translate(${sprig.x} ${sprig.y}) rotate(${sprig.angle}) scale(${sprig.scale})`}
            >
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
          ))}
        </g>
        {where === "burrow" && (
          <circle className="branch-tip" cx={STEM_X} cy={segment.h} r="3.4" />
        )}
      </svg>
    </div>
  );
}
