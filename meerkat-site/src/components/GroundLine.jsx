import Branch from "./Branch.jsx";

// The one crossing on the page: daylight above, burrow below. The sentinel
// stands on the crest, which is the only place the logo appears at size.
export default function GroundLine({ demo }) {
  const { job, windowOpen } = demo;

  return (
    <div className="ground">
      <img className="sentinel" src="/meerkat-logo.png" alt="" width="74" height="131" />
      <svg className="ground-svg" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="soilFace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--soil-raised)" />
            <stop offset="100%" stopColor="var(--soil)" />
          </linearGradient>
        </defs>
        <path
          d="M0 30 C 180 18, 320 40, 520 33 S 900 16, 1080 34 1440 26 1440 26 L1440 90 L0 90 Z"
          fill="url(#soilFace)"
        />
        <path
          className="ground-crest"
          d="M0 30 C 180 18, 320 40, 520 33 S 900 16, 1080 34 1440 26"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
        />
      </svg>
      <div className="container ground-rail">
        <Branch where="ground" live={Boolean(job)} active={Boolean(job) && windowOpen} />
      </div>
    </div>
  );
}
