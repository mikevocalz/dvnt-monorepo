"use client";

/**
 * The guest list, kept on the device.
 *
 * The door already survives a lot: no signal (scans queue), a dead decode
 * engine (`?engine=legacy`), a camera that will not start (type the code). All
 * of those still assume the CAMERA is the thing that broke.
 *
 * The case none of them cover is the one a venue actually produces: no signal
 * AND a phone that reloaded. The roster query is memory-only — there is no
 * query persister on web — so the guest list comes back empty, and the offline
 * token set that does persist holds tokens with no names. A staffer can verify
 * a code someone reads out, but cannot look anyone up. Someone whose phone is
 * dead is then unverifiable by any route.
 *
 * So the roster is snapshotted whenever it loads with signal, and the list
 * falls back to that snapshot when the fetch fails. Names, tiers, tokens and
 * check-in state as of the last successful read — stale, clearly labelled, and
 * far better than an empty screen at a door.
 *
 * localStorage rather than the offline-checkin store: that store is the
 * server's truth about tickets and drains back to it. This is a display cache,
 * it never syncs anywhere, and it must be discardable without consequence.
 */

import type { TicketRecord } from "@dvnt/app/lib/api/tickets";

const KEY = "dvnt.door.roster.v1";

/** Only the fields the list renders. A full roster row is mostly dead weight. */
export interface CachedGuest {
  id: string;
  qr_token: string;
  holder_name: string | null;
  ticket_type_name: string | null;
  status: string;
  checked_in_at: string | null;
}

interface Snapshot {
  at: number;
  guests: CachedGuest[];
}

/**
 * One event's worth. Storing every event a phone has ever opened is how a
 * door's browser hits a quota mid-shift.
 */
type Store = Record<string, Snapshot>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

export function snapshotRoster(eventId: string, tickets: TicketRecord[]): void {
  if (typeof window === "undefined" || !eventId || tickets.length === 0) return;
  const guests: CachedGuest[] = tickets.map((t) => ({
    id: String(t.id),
    qr_token: t.qr_token,
    holder_name: t.holder_name ?? null,
    ticket_type_name: t.ticket_type_name ?? null,
    status: t.status,
    checked_in_at: t.checked_in_at ?? null,
  }));
  try {
    // Last event wins. A phone works one door at a time.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ [eventId]: { at: Date.now(), guests } } satisfies Store),
    );
  } catch {
    // Quota or private mode. The cache is a bonus, never a requirement.
  }
}

export function recallRoster(
  eventId: string,
): { guests: CachedGuest[]; at: number } | null {
  const snap = read()[eventId];
  return snap && snap.guests.length ? { guests: snap.guests, at: snap.at } : null;
}
