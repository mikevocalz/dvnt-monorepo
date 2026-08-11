/**
 * Host & Guest WS-3 — the perk matrix.
 *
 * A perk maps to a MINIMUM PLAN_RANK, not to a set of plan keys, so slotting a
 * new tier into the middle of the ladder later doesn't mean rewriting every
 * event's saved config.
 *
 * Two laws are encoded here rather than left to callers:
 *  - **Nothing is granted until a host enables it.** The defaults below are a
 *    starting point an event inherits, not an entitlement the platform confers.
 *  - **Sneaky Lynk confers nothing at a door.** It is a separate product line;
 *    its ranks (1–2) sit below every default threshold deliberately, so a
 *    `sneaky_tier_2` member never picks up a door perk by rank arithmetic.
 *
 * Resolution is server-side at query and scan time. This module is shared so
 * the phone, the roster and the door all read the same rules — but the client
 * never *decides* a perk, it only renders one the server already resolved.
 */

import { PLAN_RANK } from "@dvnt/app/lib/subscription/plans";
import type { PlanKey } from "@dvnt/app/lib/subscription/types";

export type PerkKey =
  | "skip_line"
  | "early_entry"
  | "guaranteed_entry"
  | "comp_drink"
  | "table_priority";

export const PERK_LABELS: Record<PerkKey, string> = {
  skip_line: "Skip the line",
  early_entry: "Early entry",
  guaranteed_entry: "Guaranteed entry",
  comp_drink: "Complimentary drink",
  table_priority: "Table priority",
};

/** `{ perk: minimum PLAN_RANK }`. A key absent or null means the perk is OFF. */
export type PerkConfig = Partial<Record<PerkKey, number | null>>;

/**
 * Phase-0 default matrix (approved). Ranks: free 0 · sneaky 1–2 · core 3 ·
 * insider 4 · vip 5 · founders 6.
 *
 * `comp_drink` is off by default on purpose — it costs the host real money, and
 * a silent default that hands out drinks is not a default, it's a liability.
 */
export const DEFAULT_PERK_CONFIG: PerkConfig = {
  skip_line: PLAN_RANK.dvnt_insider,
  early_entry: PLAN_RANK.dvnt_vip,
  guaranteed_entry: PLAN_RANK.dvnt_founders_circle,
  comp_drink: null,
  table_priority: PLAN_RANK.dvnt_vip,
};

/** An event's config, falling back to the defaults when the host hasn't set one. */
export function effectivePerkConfig(raw: unknown): PerkConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_PERK_CONFIG;
  const out: PerkConfig = { ...DEFAULT_PERK_CONFIG };
  for (const key of Object.keys(PERK_LABELS) as PerkKey[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === null) out[key] = null;
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/**
 * Which perks does this plan actually get at this event?
 *
 * `plan` is the SERVER-RESOLVED tier — null for guests, and null for anyone
 * whose subscription no longer confers one (lapsed `past_due`, ended
 * cancellation). A lapsed member therefore gets an empty list here without this
 * function needing to know anything about billing state.
 */
export function resolvePerks(
  plan: PlanKey | null | undefined,
  config: PerkConfig,
): PerkKey[] {
  if (!plan) return [];
  const rank = PLAN_RANK[plan];
  if (rank == null) return [];
  return (Object.keys(PERK_LABELS) as PerkKey[]).filter((perk) => {
    const min = config[perk];
    return typeof min === "number" && rank >= min;
  });
}

/**
 * How many ticket-holders would qualify for a perk — the number that tells a
 * host whether they've built a perk or a second queue. WS-3 requires the cost
 * to be obvious at configuration time; a skip-the-line list of 300 is not a
 * perk, and the host should see 300 before they save.
 */
export function countQualifying(
  ranks: readonly number[],
  minRank: number | null | undefined,
): number {
  if (typeof minRank !== "number") return 0;
  return ranks.filter((r) => r >= minRank).length;
}
