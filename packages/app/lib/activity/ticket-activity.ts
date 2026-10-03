export const TICKET_ACTIVITY_TYPES = [
  "ticket_transfer_initiated",
  "ticket_transfer_accepted",
  "ticket_transfer_declined",
  "ticket_transfer_cancelled",
  "ticket_comped",
  "ticket_refunded",
  "ticket_claim_required",
  "ticket_delivery_failed",
  "ticket_voided",
  "event_cancelled",
  "event_postponed",
  "event_time_changed",
  "event_venue_changed",
] as const;

export type TicketActivityType = (typeof TICKET_ACTIVITY_TYPES)[number];

const TICKET_ACTIVITY_SET = new Set<string>(TICKET_ACTIVITY_TYPES);

export function isTicketActivityType(type: string | null | undefined): boolean {
  return !!type && TICKET_ACTIVITY_SET.has(type);
}

export function ticketActivityCopy(type: string): string | null {
  switch (type) {
    case "ticket_claim_required":
      return " has a ticket waiting for you to claim.";
    case "ticket_delivery_failed":
      return " could not deliver your ticket link. Open DVNT to finish delivery.";
    case "ticket_voided":
      return " voided a ticket for this event.";
    case "event_postponed":
      return " postponed an event you have a ticket to.";
    case "event_time_changed":
      return " changed the time for an event you have a ticket to.";
    case "event_venue_changed":
      return " changed the venue for an event you have a ticket to.";
    default:
      return null;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Transfers and claims finish on My Tickets, where pending transfers are listed. */
const CLAIM_TYPES = new Set([
  "ticket_transfer_initiated",
  "ticket_transfer_accepted",
  "ticket_transfer_declined",
  "ticket_transfer_cancelled",
  "ticket_claim_required",
]);

/** About one pass the viewer holds (or held): open that pass. */
const PASS_TYPES = new Set([
  "ticket_comped",
  "ticket_refunded",
  "ticket_voided",
  "ticket_delivery_failed",
]);

export interface TicketRouteInput {
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Event id when the row was joined to its event. */
  eventId?: string | null;
  payload?: { ticket_id?: unknown; ticketId?: unknown } | null;
}

export type ActivityPlatform = "native" | "web";

const PATHS = {
  native: {
    ticket: (id: string) => `/(protected)/ticket/${id}`,
    myTickets: "/(protected)/events/my-tickets",
  },
  web: {
    ticket: (id: string) => `/feed/ticket/${id}`,
    myTickets: "/feed/events/my-tickets",
  },
} as const;

/**
 * Where a ticket notification opens (T04): the specific pass, or the screen
 * where a transfer or claim is finished. Null for any other type, so the
 * caller keeps its existing routing.
 *
 * The ticket route takes either id. A uuid opens that exact pass; an integer
 * event id resolves to the viewer's own pass for the event, or a chooser when
 * they hold several (lib/tickets/ticket-identity.ts). Comp and refund rows
 * carry the event id as entity_id today, so they open the pass through that.
 * A ticket_id in entity_payload, when an emitter sends one, wins.
 *
 * Event-level changes (cancelled, postponed, time, venue) stay on the event
 * page, which is where the change itself is shown.
 */
export function ticketActivityRoute(
  input: TicketRouteInput,
  platform: ActivityPlatform,
): string | null {
  const paths = PATHS[platform];
  if (CLAIM_TYPES.has(input.type)) return paths.myTickets;
  if (!PASS_TYPES.has(input.type)) return null;

  const rawTicketId = input.payload?.ticket_id ?? input.payload?.ticketId;
  const ticketId = typeof rawTicketId === "string" ? rawTicketId.trim() : "";
  if (UUID_RE.test(ticketId)) return paths.ticket(ticketId);

  const eventId = String(
    input.eventId || (input.entityType === "event" ? input.entityId : "") || "",
  ).trim();
  if (/^\d+$/.test(eventId)) return paths.ticket(eventId);
  return paths.myTickets;
}
