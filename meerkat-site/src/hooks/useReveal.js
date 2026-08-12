import { useEffect, useRef } from "react";

// Adds `is-in` the first time an element scrolls into view, so CSS can bring it
// up. One observer per element, disconnected after it fires — nothing keeps
// watching things that have already arrived.
// threshold 0: a section taller than the viewport can never expose a large
// fraction of itself, so anything above 0 risks content that never arrives.
export function useReveal({ threshold = 0, rootMargin = "0px 0px -4% 0px" } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    // Without IntersectionObserver, or when motion is unwelcome, show it now
    // rather than leaving content depending on an animation that never runs.
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      el.classList.add("is-in");
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.disconnect();
          }
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, threshold]);

  return ref;
}
