/**
 * Web twin of `use-motion-tier.ts`.
 *
 * Native reads reduce-motion, low-power mode and total RAM. The browser only
 * offers the first of those honestly, so `prefers-reduced-motion: reduce` is
 * the rule and `navigator.deviceMemory` / `connection.saveData` are the two
 * hints worth taking when the UA volunteers them.
 *
 * ponytail: no low-power-mode signal on the web — the Battery Status API is
 * unshipped in Safari and Firefox and exposes no power-saver flag anywhere, so
 * a laptop in low-power mode still gets `"full"`. Reduced-motion is the ceiling.
 */

import { useEffect, useState } from "react";

export type MotionTier = "full" | "lite";

/** Below this the device is treated as memory-constrained, matching native. */
const LOW_MEMORY_GB = 4;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function resolveMotionTier(): MotionTier {
  if (typeof window === "undefined") return "full";
  try {
    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) return "lite";
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean };
    };
    if (nav.connection?.saveData) return "lite";
    if (typeof nav.deviceMemory === "number" && nav.deviceMemory < LOW_MEMORY_GB)
      return "lite";
    return "full";
  } catch {
    return "full";
  }
}

export function useMotionTier(): MotionTier {
  // Server render and first client paint must agree, so both start at "full"
  // and the effect corrects it — a hydration mismatch here would flash the very
  // animation the member asked the OS to suppress.
  const [tier, setTier] = useState<MotionTier>("full");

  useEffect(() => {
    const apply = () => setTier(resolveMotionTier());
    apply();
    const mq = window.matchMedia?.(REDUCED_MOTION_QUERY);
    mq?.addEventListener?.("change", apply);
    return () => mq?.removeEventListener?.("change", apply);
  }, []);

  return tier;
}
