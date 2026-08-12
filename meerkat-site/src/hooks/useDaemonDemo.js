import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// The hero demo's state, deliberately held above both views that show it: the
// terminal window renders `lines`, the daemon panel below the ground line
// renders `job` and `clients`. Closing the window empties `lines` without
// touching `job` — which is the product's own argument, expressed as component
// structure rather than described in a caption.

const JOB_CMD = "./backup.sh";
const TYPE_MS = 38;

export const STEPS = [
  {
    id: "start",
    action: "Start a long job",
    hint: "The engine owns that job now. The window is only where you typed it.",
  },
  {
    id: "close",
    action: "Close this window",
    hint: "Window gone. The job never noticed.",
  },
  {
    id: "reopen",
    action: "Open a new window",
    hint: "A different window, the same shell, the same job — still counting.",
  },
];

const IDLE_HINT = "The window is a view. Everything that matters lives below it.";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function useDaemonDemo() {
  const reduceMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const [step, setStep] = useState(0);
  const [lines, setLines] = useState([]);       // rendered transcript
  const [typing, setTyping] = useState(null);   // the line being typed, if any
  const [windowOpen, setWindowOpen] = useState(true);
  const [windowTitle, setWindowTitle] = useState("meerkat — window 1");
  const [job, setJob] = useState(null);         // { startedAt } — survives the window
  const jobRef = useRef(null);                  // same value, readable mid-sequence
  const [clients, setClients] = useState(1);
  const [hint, setHint] = useState(IDLE_HINT);
  const [busy, setBusy] = useState(false);

  // Guards the async step runners against a real unmount. Reset on mount, not
  // only on cleanup, so StrictMode's simulated remount doesn't leave it stuck.
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  const push = useCallback((line) => setLines((prev) => [...prev, line]), []);

  // Types into `typing`, then commits the finished line to the transcript.
  const typeLine = useCallback(
    async (text) => {
      if (reduceMotion) {
        setTyping({ kind: "input", text });
        await wait(120);
      } else {
        for (let i = 1; i <= text.length; i += 1) {
          if (cancelled.current) return;
          setTyping({ kind: "input", text: text.slice(0, i) });
          await wait(TYPE_MS);
        }
      }
      setTyping(null);
      push({ kind: "input", text });
    },
    [push, reduceMotion],
  );

  const elapsedFrom = useCallback((startedAt) => {
    const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, []);

  const advance = useCallback(async () => {
    if (busy || step >= STEPS.length) return;
    setBusy(true);
    const current = STEPS[step];

    if (current.id === "start") {
      await typeLine(`${JOB_CMD} &`);
      await wait(260);
      push({ kind: "output", text: "[1] running in the background" });
      jobRef.current = { startedAt: Date.now() };
      setJob(jobRef.current);
    }

    if (current.id === "close") {
      setWindowOpen(false);
      setClients(0);
      await wait(reduceMotion ? 0 : 520);
    }

    if (current.id === "reopen") {
      setLines([]);
      setWindowTitle("meerkat — window 2");
      setWindowOpen(true);
      setClients(1);
      await wait(reduceMotion ? 0 : 420);
      await typeLine("jobs");
      await wait(240);
      // Read the job off the ref, never inside a state updater — updaters run
      // twice under StrictMode and would print the transcript lines twice.
      push({ kind: "output", text: `[1]  running  ${JOB_CMD}` });
      push({ kind: "output", text: `     still going, ${elapsedFrom(jobRef.current.startedAt)} in` });
    }

    if (cancelled.current) return;
    setHint(current.hint);
    setStep(step + 1);
    setBusy(false);
  }, [busy, elapsedFrom, push, reduceMotion, step, typeLine]);

  const restart = useCallback(() => {
    setStep(0);
    setLines([]);
    setTyping(null);
    setWindowOpen(true);
    setWindowTitle("meerkat — window 1");
    setJob(null);
    jobRef.current = null;
    setClients(1);
    setHint(IDLE_HINT);
    setBusy(false);
  }, []);

  return {
    step,
    steps: STEPS,
    done: step >= STEPS.length,
    busy,
    lines,
    typing,
    windowOpen,
    windowTitle,
    job,
    clients,
    hint,
    jobCommand: JOB_CMD,
    elapsedFrom,
    advance,
    restart,
  };
}
