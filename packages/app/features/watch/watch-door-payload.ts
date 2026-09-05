/**
 * Host & Guest WS-6 — the door, on the host's wrist.
 *
 * Mirrors `apps/mobile/targets/watch/DoorModels.swift` (WatchDoor /
 * WatchDoorEnvelope) — keep the two in lockstep, same PR.
 *
 * A host working a door has their hands full. These are the four numbers that
 * decide what they do next, and nothing else: how many are expected, how many
 * are in, how many are still outside, and how deep the priority lane is.
 *
 * NO LOCATION CROSSES THIS WIRE. The presence feature contributes only
 * aggregate counts (WS-5 posts state words, never coordinates), so there is
 * nothing here that could describe where any individual is — by construction,
 * not by policy.
 */

export interface WatchDoorDTO {
  eventId: string;
  eventTitle: string;
  /** Live, non-refunded ticket holders. */
  expected: number;
  /** Scanned in. The door's own number — presence never contributes to it. */
  arrived: number;
  /** expected − arrived, floored at zero. */
  remaining: number;
  /** Holders with a skip-the-line perk who are not through the door yet. */
  priorityLane: number;
  /** Opted-in guests reporting `approaching`. Aggregate only. */
  approaching: number;
}

export interface WatchDoorEnvelope {
  protocol?: 2;
  accountGen?: string;
  status?: "ready" | "error";
  error?: string;
  door: WatchDoorDTO | null;
  /** Epoch seconds, stamped by the phone so the wrist shows honest staleness. */
  syncedAt: number;
}

export function buildDoorEnvelope(
  door: WatchDoorDTO | null,
): WatchDoorEnvelope {
  return { door, syncedAt: Math.floor(Date.now() / 1000) };
}

/** Stable signature so an unchanged door doesn't re-push every poll. */
export function doorSignature(env: WatchDoorEnvelope): string {
  const d = env.door;
  if (!d) return "none";
  return [
    d.eventId,
    d.expected,
    d.arrived,
    d.remaining,
    d.priorityLane,
    d.approaching,
  ].join(":");
}

/** Validate authoritative aggregate response; absent counts never become zero. */
export function authoritativeDoor(value: unknown): WatchDoorDTO | null {
  if (!value || typeof value !== "object") return null;
  const d = value as WatchDoorDTO;
  if (typeof d.eventId !== "string" || !/^[1-9][0-9]*$/.test(d.eventId) || typeof d.eventTitle !== "string") return null;
  for (const key of ["expected", "arrived", "remaining", "priorityLane", "approaching"] as const) {
    if (!Number.isSafeInteger(d[key]) || d[key] < 0) return null;
  }
  if (d.arrived > d.expected || d.remaining !== d.expected - d.arrived || d.priorityLane > d.remaining || d.approaching > d.remaining) return null;
  return { eventId: d.eventId, eventTitle: d.eventTitle, expected: d.expected, arrived: d.arrived, remaining: d.remaining, priorityLane: d.priorityLane, approaching: d.approaching };
}
