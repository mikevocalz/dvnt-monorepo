/**
 * Projects the app's ticket records into the compact DTO the Apple Watch consumes.
 * Mirrors `apps/mobile/targets/watch/Models.swift` (WatchTicket / WatchTicketEnvelope)
 * — keep the two in lockstep.
 *
 * The watch is a presenter: it renders `qrToken` byte-identical to the phone
 * (see docs/watch-app-fit.md). Nothing here is signed or rotated.
 */

import type { TicketRecord } from "@dvnt/app/lib/api/tickets";

export type WatchTicketStatus =
  | "valid"
  | "checked_in"
  | "revoked"
  | "expired"
  | "transfer_pending";

export interface WatchTicketDTO {
  id: string;
  eventId: string;
  qrToken: string;
  status: WatchTicketStatus;
  tier?: string;
  tierName?: string;
  tableNumber?: string;
  checkedInAt?: string;
  eventTitle: string;
  eventDate?: string;
  eventEndDate?: string;
  eventLocation?: string;
  entryWindow?: string;
}

export interface WatchTicketEnvelope {
  tickets: WatchTicketDTO[];
  /** Epoch seconds, stamped by the phone so the watch shows honest staleness. */
  syncedAt: number;
}

/** Map the DB status to the watch's display status. */
function mapStatus(record: TicketRecord): WatchTicketStatus {
  switch (record.status) {
    case "active":
      // An active ticket whose event has clearly passed reads as expired.
      if (record.event_date) {
        const ends = Date.parse(record.event_date);
        if (!Number.isNaN(ends) && ends < Date.now() - 24 * 60 * 60 * 1000) {
          return "expired";
        }
      }
      return "valid";
    case "scanned":
      return "checked_in";
    case "transfer_pending":
      return "transfer_pending";
    case "refunded":
    case "void":
    default:
      return "revoked";
  }
}

/** Infer a coarse tier level from the ticket-type name (matches phone accents). */
function inferTier(name?: string): string | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase();
  if (n.includes("vip")) return "vip";
  if (n.includes("table") || n.includes("booth")) return "table";
  if (n.includes("free") || n.includes("rsvp")) return "free";
  return "ga";
}

export function toWatchTicket(record: TicketRecord): WatchTicketDTO {
  return {
    id: record.id,
    eventId: String(record.event_id),
    qrToken: record.qr_token,
    status: mapStatus(record),
    tier: inferTier(record.ticket_type_name),
    tierName: record.ticket_type_name,
    checkedInAt: record.checked_in_at ?? undefined,
    eventTitle: record.event_title ?? "Event",
    eventDate: record.event_date,
    eventLocation: record.event_location,
  };
}

/**
 * Build the envelope. Only admission-style tickets belong on the wrist — coat
 * check / product / service rows aren't scanned at the door.
 */
export function buildWatchEnvelope(records: TicketRecord[]): WatchTicketEnvelope {
  const tickets = records
    .filter((r) => !r.category || r.category === "admission")
    .map(toWatchTicket);
  return { tickets, syncedAt: Math.floor(Date.now() / 1000) };
}

/** Stable signature to skip redundant pushes (qrToken + status per ticket). */
export function envelopeSignature(env: WatchTicketEnvelope): string {
  return env.tickets
    .map((t) => `${t.id}:${t.status}:${t.qrToken}`)
    .sort()
    .join("|");
}
