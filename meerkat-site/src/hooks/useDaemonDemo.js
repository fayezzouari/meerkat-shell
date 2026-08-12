import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// The hero demo's state, deliberately held above both views that show it: the
// terminal window renders `lines`, the engine panel below the ground line
// renders `job` and `clients`. Closing the window empties `lines` without
// touching `job` — which is the product's own argument, expressed as component
// structure rather than described in a caption.
//
// Only the typed input is animated. Output prints in one go, the way a real
// terminal does; fading each output line in was the tell that this is a webpage
// pretending to be a shell.

const JOB_CMD = "./backup.sh";

// Typing cadence. A fixed interval reads as a machine transcribing; a little
// jitter, plus a beat before the newline, reads as someone typing.
const KEY_MS = 24;
const KEY_JITTER_MS = 26;
const ENTER_PAUSE_MS = 190;
const OUTPUT_PAUSE_MS = 240;

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
  const [lines, setLines] = useState([]);       // committed transcript
  const [typing, setTyping] = useState(null);   // the line being typed, if any
  const [windowOpen, setWindowOpen] = useState(true);
  const [windowTitle, setWindowTitle] = useState("meerkat — window 1");
  const [job, setJob] = useState(null);         // { startedAt } — survives the window
  const [clients, setClients] = useState(1);
  const [hint, setHint] = useState(IDLE_HINT);
  const [busy, setBusy] = useState(false);

  // A ref, not the `busy` state, is what actually guards a step: several clicks
  // can land in one tick, before React has re-rendered with busy === true, and
  // two overlapping runs of a step fight over the same transcript.
  const busyRef = useRef(false);
  const skipRef = useRef(false);                // set by a click mid-animation
  const jobRef = useRef(null);                  // readable mid-sequence

  // Guards the async step runners against a real unmount. Reset on mount, not
  // only on cleanup, so StrictMode's simulated remount doesn't leave it stuck.
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  const push = useCallback((line) => setLines((prev) => [...prev, line]), []);

  // Types into `typing`, then commits the finished line to the transcript.
  //
  // Driven by elapsed time on a schedule of jittered keystroke times, read on
  // each animation frame — not by a chain of one timer per character. A chain
  // stalls mid-word whenever the browser throttles timers (an unfocused or
  // hidden tab); reading the clock means the line simply catches up to where it
  // should be as soon as frames resume.
  const typeLine = useCallback(
    (text) =>
      new Promise((resolve) => {
        const finish = () => {
          setTyping(null);
          push({ kind: "input", text });
          resolve();
        };

        if (reduceMotion || skipRef.current) {
          finish();
          return;
        }

        // Cumulative time at which each character has landed.
        const schedule = [];
        let t = 0;
        for (let i = 0; i < text.length; i += 1) {
          t += KEY_MS + Math.random() * KEY_JITTER_MS;
          schedule.push(t);
        }
        const total = t + ENTER_PAUSE_MS;
        const start = performance.now();

        const frame = (now) => {
          if (cancelled.current) {
            resolve();
            return;
          }
          if (skipRef.current) {
            finish();
            return;
          }

          const elapsed = now - start;
          let shown = 0;
          while (shown < schedule.length && schedule[shown] <= elapsed) shown += 1;
          setTyping({ text: text.slice(0, shown) });

          if (elapsed >= total) finish();
          else requestAnimationFrame(frame);
        };

        requestAnimationFrame(frame);
      }),
    [push, reduceMotion],
  );

  // Skippable pause, so a click never has to wait out a beat it did not ask for.
  const beat = useCallback(
    async (ms) => {
      if (reduceMotion || skipRef.current) return;
      await wait(ms);
    },
    [reduceMotion],
  );

  const elapsedFrom = useCallback((startedAt) => {
    const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, []);

  const advance = useCallback(async () => {
    // A click while a step is playing means "get on with it", not "do it twice".
    if (busyRef.current) {
      skipRef.current = true;
      return;
    }
    if (step >= STEPS.length) return;

    busyRef.current = true;
    skipRef.current = false;
    setBusy(true);
    const current = STEPS[step];

    if (current.id === "start") {
      await typeLine(`${JOB_CMD} &`);
      await beat(OUTPUT_PAUSE_MS);
      push({ kind: "output", text: "[1] running in the background" });
      jobRef.current = { startedAt: Date.now() };
      setJob(jobRef.current);
    }

    if (current.id === "close") {
      setWindowOpen(false);
      setClients(0);
      await beat(460);
    }

    if (current.id === "reopen") {
      setLines([]);
      setWindowTitle("meerkat — window 2");
      setWindowOpen(true);
      setClients(1);
      await beat(380);
      await typeLine("jobs");
      await beat(OUTPUT_PAUSE_MS);
      // Read the job off the ref, never inside a state updater — updaters run
      // twice under StrictMode and would print these lines twice.
      push({ kind: "output", text: `[1]  running  ${JOB_CMD}` });
      push({ kind: "output", text: `     still going, ${elapsedFrom(jobRef.current.startedAt)} in` });
    }

    busyRef.current = false;
    skipRef.current = false;
    if (cancelled.current) return;
    setHint(current.hint);
    setStep(step + 1);
    setBusy(false);
  }, [beat, elapsedFrom, push, step, typeLine]);

  const restart = useCallback(() => {
    busyRef.current = false;
    skipRef.current = false;
    jobRef.current = null;
    setStep(0);
    setLines([]);
    setTyping(null);
    setWindowOpen(true);
    setWindowTitle("meerkat — window 1");
    setJob(null);
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
