/**
 * Host & Guest WS-7 — the door numbers, and their provenance.
 *
 * Every figure a host sees at 11pm has to be traceable to a named endpoint and
 * labelled with when it was last true. This module does the deriving so the
 * dashboard components only render — and so the *source* of each number is
 * written down next to it rather than living in someone's head.
 *
 * The spec's hard rule: **a stale number is labeled stale, never shown as
 * live.** `freshnessLabel` exists so there is exactly one way to say that, and
 * `isStale` so a caller can't forget to.
 */

import type { TicketRecord } from "@dvnt/app/lib/api/tickets";
import { PLAN_RANK } from "@dvnt/app/lib/subscription/plans";
import type { PerkKey } from "@dvnt/app/lib/perks/perk-config";

/** Where each dashboard number comes from. Rendered in the UI as a caption. */
export const NUMBER_SOURCES = {
  expected: "get-event-tickets (status=active)",
  arrived: "get-event-tickets (checked_in_at set)",
  remaining: "derived: expected − arrived",
  tierMix: "get-event-tickets (membership_tier)",
  priorityLane: "get-event-tickets (perks contains skip_line)",
  presence: "event-presence (aggregate counts only)",
} as const;

export interface DoorCounts {
  expected: number;
  arrived: number;
  remaining: number;
  /** Ticket-holders whose resolved perks include skip_line and who aren't in yet. */
  priorityLaneWaiting: number;
  /** planKey → count, paid tiers only. The room's tier mix. */
  tierMix: Record<string, number>;
}

/**
 * Derive the door counts from a roster page.
 *
 * NOTE the caller's responsibility: this is only true of the rows it was given.
 * On a paged roster the dashboard must pass the FULL set (or use the server's
 * totals) — deriving "arrived" from page one and calling it the room is exactly
 * the kind of number that lies at 11pm.
 */
export function deriveDoorCounts(tickets: readonly TicketRecord[]): DoorCounts {
  let expected = 0;
  let arrived = 0;
  let priorityLaneWaiting = 0;
  const tierMix: Record<string, number> = {};

  for (const t of tickets) {
    // Refunded / void tickets are not people at a door.
    if (t.status === "refunded" || t.status === "void") continue;
    expected += 1;

    const isIn = !!t.checked_in_at;
    if (isIn) arrived += 1;

    const plan = t.membership_tier?.planKey;
    if (plan && plan !== "free") tierMix[plan] = (tierMix[plan] ?? 0) + 1;

    if (!isIn && (t.perks ?? []).includes("skip_line" as PerkKey)) {
      priorityLaneWaiting += 1;
    }
  }

  return {
    expected,
    arrived,
    remaining: Math.max(0, expected - arrived),
    priorityLaneWaiting,
    tierMix,
  };
}

/**
 * The priority lane itself: who staff should be watching for, highest tier
 * first, then longest-waiting. Only people not yet through the door — someone
 * already inside is not in a lane.
 */
export function priorityLane(
  tickets: readonly TicketRecord[],
): TicketRecord[] {
  return tickets
    .filter(
      (t) =>
        !t.checked_in_at &&
        t.status !== "refunded" &&
        t.status !== "void" &&
        (t.perks ?? []).length > 0,
    )
    .sort((a, b) => {
      const ra = a.membership_tier?.rank ?? PLAN_RANK.free;
      const rb = b.membership_tier?.rank ?? PLAN_RANK.free;
      if (ra !== rb) return rb - ra;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
}

/** Older than this and a door number is not "live" any more. */
export const STALE_AFTER_MS = 60_000;

export function isStale(fetchedAt: number | null, now = Date.now()): boolean {
  if (fetchedAt == null) return true;
  return now - fetchedAt > STALE_AFTER_MS;
}

/**
 * One way to say when a number was last true. Never returns "live" for
 * something that isn't — at 11pm on bad wifi that distinction is the whole
 * point of the dashboard.
 */
export function freshnessLabel(
  fetchedAt: number | null,
  now = Date.now(),
): string {
  if (fetchedAt == null) return "No data yet";
  const age = Math.max(0, now - fetchedAt);
  if (age <= STALE_AFTER_MS) return "Live";
  const mins = Math.floor(age / 60_000);
  if (mins < 60) return `As of ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `As of ${hrs}h ago`;
}
