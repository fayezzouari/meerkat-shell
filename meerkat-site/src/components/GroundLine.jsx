// The one crossing on the page: daylight above, burrow below. The sentinel
// stands on the crest, which is the only place the logo appears at size.
export default function GroundLine() {
  return (
    <div className="ground" aria-hidden="true">
      <img className="sentinel" src="/meerkat-logo.png" alt="" width="74" height="131" />
      <svg className="ground-svg" viewBox="0 0 1440 90" preserveAspectRatio="none">
        <path
          d="M0 30 C 180 18, 320 40, 520 33 S 900 16, 1080 34 1440 26 1440 26 L1440 90 L0 90 Z"
          fill="var(--soil)"
        />
        <path
          d="M0 30 C 180 18, 320 40, 520 33 S 900 16, 1080 34 1440 26"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          opacity=".5"
        />
      </svg>
    </div>
  );
}
