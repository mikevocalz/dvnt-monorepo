/**
 * Membership tier identity — the visual half of `lib/subscription`.
 *
 * `lib/subscription/plans.ts` owns what a tier CAN DO; this owns what it LOOKS
 * LIKE. Kept apart on purpose: entitlements are a money/access concern that is
 * server-authoritative, and a colour must never become the thing an access
 * check reads.
 *
 * Note this is NOT `theme/tier-colors.ts` — that file is TICKET tiers
 * (ga / vip / table) on an event. These are MEMBERSHIP tiers on a person. Two
 * different ladders that both say "vip", which is exactly why they get separate
 * modules and separate types.
 */

import type { PlanKey } from "@dvnt/app/lib/subscription/types";
import { color } from "./tokens";

export interface TierIdentity {
  /** Display name, matching `plans.ts` `name`. */
  label: string;
  /**
   * Where the tier sits on the ladder. Drives which badge wins when someone
   * holds both a Sneaky and a membership plan — higher rank shows.
   */
  rank: number;
  /**
   * The three stops of the metallic sweep: shadow, body, highlight.
   *
   * A real metal is not one colour — it is a dark base with a bright specular
   * band travelling across it. One flat hex reads as plastic, which is the
   * failure mode these badges exist to avoid.
   */
  metal: { shadow: string; body: string; highlight: string };
  /** Flat colour for places too small to shade (a 12pt inline dot, a chip). */
  flat: string;
}

/**
 * Free has no identity on purpose — there is no badge for not subscribing, and
 * a "Free" chip next to a name is a scarlet letter, not a feature.
 */
export const TIER_IDENTITY: Record<Exclude<PlanKey, "free">, TierIdentity> = {
  // ── Sneaky Lynk family — the teal end of the brand gradient. ──
  sneaky_tier_1: {
    label: "Sneaky Tier 1",
    rank: 10,
    metal: { shadow: "#07222E", body: color.tealDeep, highlight: "#3E8FAE" },
    flat: color.tealDeep,
  },
  sneaky_tier_2: {
    label: "Sneaky Tier 2",
    rank: 20,
    metal: { shadow: "#0C3A50", body: "#1C6E90", highlight: color.cyan },
    flat: "#1C6E90",
  },

  // ── DVNT membership — walks the brand gradient teal-blue → purple, so the
  //    ladder reads as one family getting richer rather than four unrelated
  //    colours. ──
  dvnt_core: {
    label: "Core",
    rank: 30,
    metal: { shadow: "#14435C", body: color.cyan, highlight: "#8FD3F4" },
    flat: color.cyan,
  },
  dvnt_insider: {
    label: "Insider",
    rank: 40,
    metal: { shadow: "#3A1F52", body: color.violet, highlight: "#C79BE0" },
    flat: color.violet,
  },
  dvnt_vip: {
    label: "VIP",
    rank: 50,
    metal: { shadow: "#2A1240", body: color.purpleDeep, highlight: "#B57CE8" },
    flat: color.purpleDeep,
  },

  // ── Founders Circle — the only tier that leaves the gradient. Gold is the
  //    brand's scarcity colour (it is already "price goes up" on Early Bird),
  //    and the top tier has to be legible as different at a glance, not just
  //    darker. ──
  dvnt_founders_circle: {
    label: "Founders Circle",
    rank: 60,
    metal: { shadow: "#6B4E05", body: color.gold, highlight: "#FFF1AE" },
    flat: color.gold,
  },
};

/** The identity for a plan, or null for `free` / unknown. */
export function tierIdentity(plan: PlanKey | null | undefined): TierIdentity | null {
  if (!plan || plan === "free") return null;
  return TIER_IDENTITY[plan] ?? null;
}

/**
 * The badge to show when someone holds plans in both families.
 *
 * A DVNT membership always includes Sneaky Lynk (`types.ts`), so showing both
 * marks would be saying the same thing twice. Highest rank wins.
 */
export function highestTier(plans: (PlanKey | null | undefined)[]): TierIdentity | null {
  return plans
    .map(tierIdentity)
    .filter((t): t is TierIdentity => t !== null)
    .sort((a, b) => b.rank - a.rank)[0] ?? null;
}
