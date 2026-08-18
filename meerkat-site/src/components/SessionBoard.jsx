import { useEffect, useState } from "react";

// What the project actually is, shown rather than described: sessions that are
// still running while nothing is attached to them.
//
// The hero used to spend its right column on an install gesture — a disk image
// with an app walking into a folder. That is a picture of a download, not a
// picture of Meerkat. This is the engine's own view of itself: three live
// sessions, their clocks running, and a footer that says no window is open.
// The clocks tick because a still screenshot of a clock proves nothing.

const EPOCHS = 40;

const SESSIONS = [
  { name: "train", cmd: "python train.py --epochs 40", from: 8_412 },
  { name: "deploy", cmd: "terraform apply", from: 1_236, work: "12 resources planned" },
  { name: "logs", cmd: "tail -f prod.log", from: 74_310, work: "streaming" },
];

// A shell session is measured in how long it has been up, so the clock is the
// one number every row carries.
function clock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h >= 24
    ? `${Math.floor(h / 24)}d ${pad(h % 24)}:${pad(m)}`
    : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function SessionBoard() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="board" aria-hidden="true">
      <div className="board-bar">
        <span className="board-dot" />
        <span className="board-cmd">
          <span className="board-prompt">❯</span> meerkat ls
        </span>
        <span className="board-badge">engine up</span>
      </div>

      <ul className="board-list">
        {SESSIONS.map((session, i) => {
          // The long job is the one the page is arguing for, so it is the one
          // that visibly moves: an epoch lands every few seconds it is watched.
          const epoch = Math.min(EPOCHS, 27 + Math.floor(tick / 8));
          return (
            <li className="board-row" key={session.name} style={{ "--i": i }}>
              <span className="board-live" />
              <span className="board-name">{session.name}</span>
              <span className="board-proc">{session.cmd}</span>
              <span className="board-clock">{clock(session.from + tick)}</span>
              <span className="board-work">
                {session.work ?? `epoch ${epoch}/${EPOCHS}`}
                {!session.work && (
                  <span className="board-prog">
                    <span style={{ width: `${(epoch / EPOCHS) * 100}%` }} />
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="board-foot">
        <span className="board-foot-key">windows attached</span>
        <span className="board-foot-val">none — everything above is still running</span>
      </div>
    </div>
  );
}
