/**
 * Shared GSAP + ScrollTrigger foundation for the landing's web section splits.
 *
 * WEB ONLY — this module is imported exclusively from `*.web.tsx` files, so
 * Metro never bundles gsap onto native. It registers ScrollTrigger once, runs
 * the caller's animation setup inside a scoped `gsap.context` (auto-cleaned on
 * unmount / dep change), and short-circuits to no motion when the user prefers
 * reduced motion — the static layout then stands on its own.
 *
 * The whole landing scrolls the window (ScreenScrollView `useWindowScrolling`),
 * which is exactly ScrollTrigger's default scroller, so triggers compose with
 * the existing Reanimated window-scroll timeline without a second scroller.
 */
import { useEffect, useRef, type DependencyList } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;
function ensureRegistered() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(ScrollTrigger);
  registered = true;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface GsapScope {
  /** The scoping element — spread onto your section's root. */
  ref: React.RefObject<HTMLElement | null>;
  /** True when motion is suppressed (reduced-motion). */
  reduced: boolean;
}

/**
 * Run `setup(self, ctx)` once mounted, scoped to the returned ref. `self` is the
 * scope element; selector strings inside `setup` resolve within it. Return a
 * cleanup from `setup` if you add listeners beyond gsap tweens/triggers.
 */
export function useGsapScope(
  setup: (self: HTMLElement, gsapInstance: typeof gsap) => void | (() => void),
  deps: DependencyList = [],
): React.RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    ensureRegistered();
    if (prefersReducedMotion()) return; // static layout is the fallback

    let userCleanup: void | (() => void);
    // gsap.context's callback arg is the Context, not the element — pass the
    // scoped element (`el`) so `setup` can query within it. Scoping for any
    // selector strings still comes from the element handed to gsap.context.
    const ctx = gsap.context(() => {
      userCleanup = setup(el, gsap);
    }, el);

    return () => {
      userCleanup?.();
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

export { gsap, ScrollTrigger };
