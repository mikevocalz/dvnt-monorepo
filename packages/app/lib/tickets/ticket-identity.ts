/**
 * Ticket identity — the rules that decide WHICH pass a route resolves to.
 *
 * `tickets.id` is a uuid and `events.id` is an integer
 * (`supabase/migrations/20260313_catchup_all.sql:88-90`), so one `/ticket/:id`
 * route can carry both without a param rename and without breaking the deep
 * links already in the wild (`dvnt://ticket/<event_id>` from the watch,
 * calendar, and share paths).
 *
 * The rule this module exists to enforce: an event id NEVER silently picks a
 * pass. It resolves to the group, and a group with more than one pass makes the
 * viewer choose. Only a ticket id addresses a specific credential.
 */

import type { TicketRecord } from "@dvnt/app/lib/api/tickets";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TicketRouteParam =
  | { kind: "ticket"; ticketId: string }
  | { kind: "event"; eventId: string }
  | { kind: "invalid" };

/** Classify a `/ticket/:id` param without asking the network. */
export function classifyTicketRouteParam(raw: unknown): TicketRouteParam {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return { kind: "invalid" };
  const id = value.trim();
  if (!id) return { kind: "invalid" };
  if (UUID_RE.test(id)) return { kind: "ticket", ticketId: id };
  if (/^\d+$/.test(id)) return { kind: "event", eventId: id };
  return { kind: "invalid" };
}

/**
 * Admission comes first, then everything else in issue order. A coat-check
 * claim must never be the pass that opens at the door (§13), and a stable
 * order means "Ticket 1 of N" means the same thing on every refetch.
 */
const CATEGORY_RANK: Record<string, number> = {
  admission: 0,
  product: 1,
  service: 2,
  coat_check: 3,
};

function rank(ticket: TicketRecord): number {
  return CATEGORY_RANK[ticket.category ?? "admission"] ?? 1;
}

/** Deterministic display order for one event's passes. */
export function orderTicketGroup(tickets: readonly TicketRecord[]): TicketRecord[] {
  return [...tickets].sort((a, b) => {
    const byCategory = rank(a) - rank(b);
    if (byCategory !== 0) return byCategory;
    const byCreated = (a.created_at ?? "").localeCompare(b.created_at ?? "");
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
  });
}

export type TicketResolution =
  | { kind: "ticket"; ticket: TicketRecord; group: TicketRecord[]; index: number }
  /** An event id with more than one pass: the viewer chooses, we do not. */
  | { kind: "group"; group: TicketRecord[] }
  | { kind: "not-found" };

/**
 * Resolve a route param against the caller's own tickets.
 *
 * `tickets` must already be account-scoped — this function does not check
 * ownership, the server query does (`get-my-tickets` filters on the session's
 * user id). Passing another account's rows here would resolve them.
 */
export function resolveTicketRoute(
  param: TicketRouteParam,
  tickets: readonly TicketRecord[],
): TicketResolution {
  if (param.kind === "invalid") return { kind: "not-found" };

  if (param.kind === "ticket") {
    const match = tickets.find((t) => t.id === param.ticketId);
    if (!match) return { kind: "not-found" };
    const group = orderTicketGroup(
      tickets.filter((t) => String(t.event_id) === String(match.event_id)),
    );
    return {
      kind: "ticket",
      ticket: match,
      group,
      index: group.findIndex((t) => t.id === match.id),
    };
  }

  const group = orderTicketGroup(
    tickets.filter((t) => String(t.event_id) === String(param.eventId)),
  );
  if (group.length === 0) return { kind: "not-found" };
  if (group.length === 1) {
    return { kind: "ticket", ticket: group[0], group, index: 0 };
  }
  return { kind: "group", group };
}

/** Canonical in-app path for a specific credential. */
export function ticketPath(ticketId: string): string {
  return `/(protected)/ticket/${ticketId}`;
}
