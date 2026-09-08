/**
 * My Tickets is a pass library, not a transaction list.
 *
 * This module holds the two decisions the screen must not improvise:
 * which section a pass belongs in, and what the screen is allowed to tell the
 * member about a read that did not succeed.
 */

import type { TicketRecord } from "@dvnt/app/lib/api/tickets";
import { orderTicketGroup } from "./ticket-identity.ts";

/**
 * How long an event stays "attendable" past its start when the server did not
 * send an end time. `get-my-tickets` joins `events.end_date` but does not yet
 * map it onto the row, so this is the fallback, not the rule.
 */
const ASSUMED_EVENT_LENGTH_MS = 6 * 60 * 60 * 1000;

/** A pass that cannot be presented at a door. */
const SPENT_STATUSES = new Set(["refunded", "void"]);

export interface TicketGroup {
  eventId: string;
  eventTitle: string;
  eventImage?: string;
  eventLocation?: string;
  /** Event start, ISO. Empty when the server sent none. */
  eventDate: string;
  /** When this event stops being attendable, ms epoch. `null` if undated. */
  endsAt: number | null;
  tickets: TicketRecord[];
}

export type LibrarySection = "needs-attention" | "upcoming" | "past";

export interface TicketLibrary {
  needsAttention: TicketGroup[];
  upcoming: TicketGroup[];
  past: TicketGroup[];
}

function endOfEvent(ticket: TicketRecord): number | null {
  const end = (ticket as { event_end_date?: string | null }).event_end_date;
  const endMs = end ? Date.parse(end) : NaN;
  if (Number.isFinite(endMs)) return endMs;
  const startMs = ticket.event_date ? Date.parse(ticket.event_date) : NaN;
  if (Number.isFinite(startMs)) return startMs + ASSUMED_EVENT_LENGTH_MS;
  return null;
}

/**
 * A pass wants the member's attention when it is mid-flight: a transfer they
 * started or received, or an event whose passes have not all been issued.
 * `transfer_pending` is the only such state the `tickets` table can hold
 * (`migrations/20260328_ticket_transfers.sql:40`) — `payment_pending` lives on
 * `orders`/`carts`, never on a ticket row.
 */
function needsAttention(ticket: TicketRecord): boolean {
  return ticket.status === "transfer_pending";
}

export function groupTicketsByEvent(
  tickets: readonly TicketRecord[],
): TicketGroup[] {
  const byEvent = new Map<string, TicketRecord[]>();
  for (const ticket of tickets) {
    const key = String(ticket.event_id);
    const bucket = byEvent.get(key);
    if (bucket) bucket.push(ticket);
    else byEvent.set(key, [ticket]);
  }

  return [...byEvent.entries()].map(([eventId, group]) => {
    const ordered = orderTicketGroup(group);
    const head = ordered[0];
    return {
      eventId,
      eventTitle: head.event_title || "Event",
      eventImage: head.event_image || undefined,
      eventLocation: head.event_location || undefined,
      eventDate: head.event_date || "",
      endsAt: endOfEvent(head),
      tickets: ordered,
    };
  });
}

/**
 * Split the library into its three sections.
 *
 * Ordering is by when the event stops being attendable, not by a rolling
 * 24-hour cutoff — an overnight event that started last night is still
 * tonight's pass, and a member at that door must not have to open "Past" to
 * find it. Undated events sort last within Upcoming rather than vanishing.
 */
export function buildTicketLibrary(
  tickets: readonly TicketRecord[],
  now: number = Date.now(),
): TicketLibrary {
  const groups = groupTicketsByEvent(tickets);

  const needsAttentionGroups: TicketGroup[] = [];
  const upcoming: TicketGroup[] = [];
  const past: TicketGroup[] = [];

  for (const group of groups) {
    if (group.tickets.some(needsAttention)) {
      needsAttentionGroups.push(group);
      continue;
    }
    // A refunded or voided pass is history even before the doors open.
    const allSpent = group.tickets.every((t) => SPENT_STATUSES.has(t.status));
    const over = group.endsAt !== null && group.endsAt < now;
    if (allSpent || over) past.push(group);
    else upcoming.push(group);
  }

  const soonestFirst = (a: TicketGroup, b: TicketGroup) => {
    if (a.endsAt === null && b.endsAt === null) return 0;
    if (a.endsAt === null) return 1;
    if (b.endsAt === null) return -1;
    return a.endsAt - b.endsAt;
  };

  return {
    needsAttention: needsAttentionGroups.sort(soonestFirst),
    upcoming: upcoming.sort(soonestFirst),
    // History reads newest first.
    past: past.sort((a, b) => soonestFirst(b, a)),
  };
}

/**
 * The pass the "next event" shortcut should open, and whether it is safe to
 * open one at all.
 *
 * Several passes for the same event resolve to the event's group, never to a
 * guess about which one the member meant.
 */
export function nextEventShortcut(
  library: TicketLibrary,
): { kind: "ticket"; ticketId: string } | { kind: "group"; eventId: string } | null {
  const next = library.upcoming[0];
  if (!next) return null;
  const presentable = next.tickets.filter((t) => !SPENT_STATUSES.has(t.status));
  if (presentable.length === 0) return null;
  if (presentable.length === 1) {
    return { kind: "ticket", ticketId: presentable[0].id };
  }
  return { kind: "group", eventId: next.eventId };
}

/**
 * Counts for the drawer. Events and passes are counted separately because
 * "3" next to My Tickets means nothing if it could be either, and invalid
 * credentials are excluded because they are not something to go and use.
 */
export function libraryCounts(library: TicketLibrary): {
  upcomingEvents: number;
  upcomingPasses: number;
  needsAttention: number;
} {
  const passes = library.upcoming.reduce(
    (total, group) =>
      total + group.tickets.filter((t) => !SPENT_STATUSES.has(t.status)).length,
    0,
  );
  return {
    upcomingEvents: library.upcoming.length,
    upcomingPasses: passes,
    needsAttention: library.needsAttention.length,
  };
}

/**
 * What a screen is allowed to render, given a query's state.
 *
 * The distinction that matters: `failed` and `empty` are different answers, and
 * a failed refresh over already-loaded passes is `stale`, not either of them.
 * The old screen collapsed all three into "No tickets yet".
 */
export type LibraryViewState =
  | "loading"
  | "ready"
  /** Loaded passes are on screen but the latest read failed. Keep them. */
  | "stale"
  | "empty"
  | "failed";

export function libraryViewState(input: {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
  ticketCount: number;
}): LibraryViewState {
  if (input.isError) return input.hasData ? "stale" : "failed";
  if (input.isLoading && !input.hasData) return "loading";
  if (!input.hasData) return "loading";
  return input.ticketCount === 0 ? "empty" : "ready";
}
