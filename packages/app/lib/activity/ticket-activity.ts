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
