import { useEffect, type RefObject } from "react";

/**
 * Mobile Safari can keep bottom:0 attached to the pre-keyboard layout viewport
 * after an editor field blurs. Anchor from the visual viewport's TOP instead,
 * accounting for keyboard panning as well as its height. Keep the body portal:
 * this does not make fixed positioning safe inside a transformed ancestor.
 *
 * Update only the chrome DOM node, not React state or the route tree, on scroll.
 * No focus changes, scroll nudges, user-agent checks, or zoom restrictions.
 */
export function useVisualViewportBottom(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const element = ref.current;
    const viewport = window.visualViewport;
    if (!enabled || !element || !viewport) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      if (viewport.height <= 0) return;
      element.style.setProperty("--dvnt-visible-bottom", `${viewport.offsetTop + viewport.height}px`);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("pageshow", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("pageshow", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      element.style.removeProperty("--dvnt-visible-bottom");
    };
  }, [ref, enabled]);
}
