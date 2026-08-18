import { useEffect, useState } from "react";

// Which section the reader is in, for the nav's caret.
//
// Not "the topmost visible section": several are visible at once and that
// flickers at the seams. Instead every section reports its own visibility and
// the most visible one wins, which is stable while scrolling through a boundary.
//
// Thresholds rather than a single 0: a section taller than the viewport never
// exposes more than a fraction of itself, so its ratio has to be sampled as it
// passes rather than tested against one cutoff.
export function useActiveSection(ids) {
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;

    const elements = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (!elements.length) return undefined;

    const ratios = new Map(elements.map((el) => [el.id, 0]));

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        let best = null;
        let bestRatio = 0;
        for (const [id, ratio] of ratios) {
          if (ratio > bestRatio) {
            best = id;
            bestRatio = ratio;
          }
        }
        setActive(best);
      },
      {
        threshold: [0, 0.12, 0.25, 0.5, 0.75, 1],
        // The nav sits over the top of the page, so a section is only really
        // "in view" once it clears it.
        rootMargin: "-80px 0px -35% 0px",
      },
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [ids]);

  return active;
}
