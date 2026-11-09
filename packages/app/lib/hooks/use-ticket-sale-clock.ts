import { useEffect, useReducer } from "react";
import type { TierVisibilityInput } from "../tickets/pricing";

/** Re-evaluate a mounted buyer screen when its next tier opens, without polling. */
export function useTicketSaleClock(tiers: readonly TierVisibilityInput[]): number {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const now = Date.now();
  const nextStart = Math.min(...tiers.map((tier) => {
    const start = tier.sale_start !== undefined ? tier.sale_start : tier.saleStart;
    const at = start == null ? NaN : Date.parse(start);
    return Number.isFinite(at) && at > now ? at : Infinity;
  }));
  useEffect(() => {
    if (!Number.isFinite(nextStart)) return;
    // Bound long waits below the platform timeout limit. A late/background
    // callback uses the current clock, so overdue tiers open on resume.
    const timer = setTimeout(refresh, Math.min(Math.max(0, nextStart - Date.now()), 86_400_000));
    return () => clearTimeout(timer);
  }, [nextStart, now]);
  return now;
}
