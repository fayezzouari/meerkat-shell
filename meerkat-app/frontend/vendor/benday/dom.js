const noop = () => {
};
const canObserve = typeof window !== "undefined";
function resolveInk(canvas, color) {
  if (color !== "currentColor") {
    return color;
  }
  return getComputedStyle(canvas).color || "#000";
}
function watchTheme(onChange) {
  if (!canObserve) {
    return noop;
  }
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["class", "data-theme", "style"],
    attributes: true,
    subtree: true
  });
  return () => {
    query.removeEventListener("change", onChange);
    observer.disconnect();
  };
}
function prefersReducedMotion() {
  if (!canObserve) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function watchReducedMotion(onChange) {
  if (!canObserve) {
    return noop;
  }
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const handler = (event) => onChange(event.matches);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}
function watchPaintability(element, onChange) {
  if (!canObserve) {
    return noop;
  }
  let onScreen = true;
  const emit = () => onChange(onScreen && document.visibilityState !== "hidden");
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    const [entry] = entries;
    if (entry) {
      onScreen = entry.isIntersecting;
      emit();
    }
  });
  observer?.observe(element);
  document.addEventListener("visibilitychange", emit);
  if (!observer) {
    emit();
  }
  return () => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", emit);
  };
}
function devicePixelRatioCapped(max = 3, min = 2) {
  const ratio = typeof devicePixelRatio === "undefined" ? 1 : devicePixelRatio;
  return Math.min(max, Math.max(min, ratio || 1));
}
export {
  devicePixelRatioCapped,
  prefersReducedMotion,
  resolveInk,
  watchPaintability,
  watchReducedMotion,
  watchTheme
};
