import { useCallback, useEffect, useRef, useState } from "react";

// Copy-to-clipboard with a label that reports what happened: "Copied" on
// success, "Select it" when the browser refuses, back to "Copy" after a beat.
export function useCopy(text, resetAfter = 1800) {
  const [state, setState] = useState("idle"); // idle | copied | failed
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), resetAfter);
  }, [resetAfter, text]);

  const label = state === "copied" ? "Copied" : state === "failed" ? "Select it" : "Copy";
  return { copy, label, state };
}
