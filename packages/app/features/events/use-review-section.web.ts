import { useEffect, useRef } from "react";

/** Reveal the existing detail section; never open or submit its composer.
 * Public navigation is fixed, and late media/font layout can move the target
 * after scrollIntoView. Keep its heading clear until the visitor takes control. */
export function useReviewSection(eventId: string | number | null | undefined, requested: boolean, ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const section = ref.current;
    if (!eventId || !requested || !ready || !section) return;
    let active = true;
    let frame: number | undefined;
    let observer: ResizeObserver | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    const clearOverlap = () => {
      if (!active || !section.isConnected) return;
      const rect = section.getBoundingClientRect();
      if (rect.height <= 0) return; // hidden/unmounted surface, not a layout target
      let inset = parseFloat(window.getComputedStyle(section).scrollMarginTop) || 96;
      for (const header of Array.from(document.querySelectorAll("header"))) {
        const style = window.getComputedStyle(header);
        const box = header.getBoundingClientRect();
        if ((style.position === "fixed" || style.position === "sticky") &&
            box.height > 0 && box.top >= 0 && box.top <= 16 && box.bottom < window.innerHeight / 2 &&
            box.left <= rect.left + rect.width / 2 && box.right >= rect.left + rect.width / 2) {
          inset = Math.max(inset, box.bottom + 16);
        }
      }
      if (rect.top < inset - 1) window.scrollBy({ top: rect.top - inset, behavior: "instant" });
    };
    const stop = () => {
      active = false;
      observer?.disconnect();
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      for (const event of inputs) window.removeEventListener(event, stop, true);
    };
    for (const event of inputs) window.addEventListener(event, stop, { capture: true, passive: true });
    section.scrollIntoView({ block: "start", behavior: "instant" });
    section.focus({ preventScroll: true });
    clearOverlap();
    if (typeof window.requestAnimationFrame === "function") frame = window.requestAnimationFrame(clearOverlap);
    if (typeof window.ResizeObserver === "function") {
      observer = new window.ResizeObserver(clearOverlap);
      observer.observe(document.body);
      for (const header of Array.from(document.querySelectorAll("header"))) observer.observe(header);
    }
    // Only initial media/font settling: never retain an indefinite scroll lock.
    settleTimer = setTimeout(stop, 3000);
    return stop;
  }, [eventId, requested, ready]);
  return ref;
}
