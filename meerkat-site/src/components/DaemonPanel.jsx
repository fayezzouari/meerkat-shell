import { useEffect, useState } from "react";

// The other half of the demo, below the ground line. It reads the same job the
// window's transcript came from — so when the window closes, this keeps
// counting. The clock ticks off the job's own start time, not a render count.
export default function DaemonPanel({ demo }) {
  const { job, clients, jobCommand, elapsedFrom } = demo;
  const [, tick] = useState(0);

  useEffect(() => {
    if (!job) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [job]);

  return (
    <section className="chamber" aria-labelledby="daemon-h">
      <div className="jobs" data-detached={clients === 0}>
        <div className="jobs-head">
          <span>running now</span>
          <span className="socket">
            windows open: <b>{clients}</b>
          </span>
        </div>
        <div className="jobs-body">
          {job ? (
            <div className="job-row">
              <span className="job-id">[1]</span>
              <span className="job-state">running</span>
              <span className="job-cmd">{jobCommand}</span>
              <span className="job-elapsed">{elapsedFrom(job.startedAt)}</span>
            </div>
          ) : (
            <p className="jobs-empty">Nothing running. Start something above.</p>
          )}
        </div>
      </div>

      <div className="chamber-head">
        <h2 id="daemon-h">The engine</h2>
        <p className="chamber-sub">
          It holds your running work, your place in the file system, your history —
          and it keeps holding them while no window is open at all.
        </p>
      </div>
    </section>
  );
}
