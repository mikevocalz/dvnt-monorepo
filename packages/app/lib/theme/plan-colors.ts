/**
 * Subscription-tier accents — the MEMBERSHIP axis.
 *
 * This is deliberately a separate file from `tier-colors.ts`, which is the
 * TICKET axis (`free | ga | vip | table`). The two are different things and the
 * host/guest spec's first law is that they are never merged: a GA ticket held by
 * a Founders Circle member is `ga` on one axis and `dvnt_founders_circle` on the
 * other, and a roster row shows both.
 *
 * Labels are not restated here — `PLANS[key].name` already owns them, so this
 * module is colour only and there is nothing to keep in sync.
 *
 * Palette is drawn from the design system's existing brand stops so the wrist,
 * the roster and the ticket chip agree without inventing new hexes:
 *   cyan #3FDCFF · violet #8A40CF · magenta #FF5BFC · gold #F5C518
 */

import { PLANS, PLAN_RANK } from "@dvnt/app/lib/subscription/plans";
import type { PlanKey } from "@dvnt/app/lib/subscription/types";

/**
 * Accent per plan. `free` gets a muted neutral rather than a brand stop: a
 * member with no paid tier must never read as a *negative* state on a roster,
 * and a saturated colour would make "free" look like a label being pointed at.
 */
export const planHex: Record<PlanKey, string> = {
  free: "#8A8A8E",
  sneaky_tier_1: "#3FDCFF",
  sneaky_tier_2: "#34A2DF",
  dvnt_core: "#8A40CF",
  dvnt_insider: "#C084FC",
  dvnt_vip: "#FF5BFC",
  dvnt_founders_circle: "#F5C518",
};

export function planAccent(plan: PlanKey | null | undefined): string {
  return plan ? planHex[plan] : planHex.free;
}

/** Display label for a plan — single source is the plan table itself. */
export function planLabel(plan: PlanKey | null | undefined): string | null {
  return plan ? PLANS[plan].name : null;
}

/**
 * Does this plan clear a rank threshold? The perk engine compares by rank, not
 * by key, so a new tier slotted into the middle does not require touching every
 * perk rule.
 */
export function planRankAtLeast(
  plan: PlanKey | null | undefined,
  minimum: PlanKey,
): boolean {
  if (!plan) return false;
  return PLAN_RANK[plan] >= PLAN_RANK[minimum];
}
