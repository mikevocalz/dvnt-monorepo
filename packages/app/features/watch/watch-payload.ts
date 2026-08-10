/**
 * Projects the app's ticket records into the compact DTO the Apple Watch consumes.
 * Mirrors `apps/mobile/targets/watch/Models.swift` (WatchTicket / WatchTicketEnvelope)
 * — keep the two in lockstep.
 *
 * The watch is a presenter: it renders `qrToken` byte-identical to the phone
 * (see docs/watch-app-fit.md). Nothing here is signed or rotated.
 */

import type { TicketRecord } from "@dvnt/app/lib/api/tickets";

/**
 * The matrix generator behind `react-native-qrcode-svg` — the very encoder the
 * phone's own ticket QR renders from, so the wrist shows what the phone shows.
 * Untyped and CommonJS-required (Metro only resolves literal-string requires),
 * matching the lazy-require style in `watch-bridge.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const genMatrixModule = require("react-native-qrcode-svg/src/genMatrix");
const genMatrix: (value: string, errorCorrectionLevel: string) => number[][] =
  genMatrixModule.default ?? genMatrixModule;

export type WatchTicketStatus =
  | "valid"
  | "checked_in"
  | "revoked"
  | "expired"
  | "transfer_pending";

/**
 * The QR module grid the watch draws. watchOS has no Core Image, so the phone
 * encodes here and the watch only paints. Hex, row-major, 4 modules per
 * character, most-significant bit first. Mirrors `WatchQRMatrix` in
 * `apps/mobile/targets/watch/Models.swift`.
 */
export interface WatchQRMatrix {
  size: number;
  bits: string;
}

export interface WatchTicketDTO {
  id: string;
  eventId: string;
  qrToken: string;
  /** Only carried for a `valid` ticket — see `toWatchTicket`. */
  qrMatrix?: WatchQRMatrix;
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

/**
 * Encode the token into the module grid the watch paints, at error-correction
 * level "H" — the level the phone renders, so both read identically at the door.
 * Returns undefined rather than throwing: the watch falls back to its placeholder
 * and the member can still present the phone.
 */
export function toQRMatrix(token: string): WatchQRMatrix | undefined {
  if (!token) return undefined;
  try {
    const rows = genMatrix(token, "H");
    const size = rows.length;
    if (!size) return undefined;

    let bits = "";
    let nibble = 0;
    let filled = 0;
    for (const row of rows) {
      for (const module of row) {
        nibble = (nibble << 1) | (module ? 1 : 0);
        if (++filled === 4) {
          bits += nibble.toString(16);
          nibble = 0;
          filled = 0;
        }
      }
    }
    // Pad the tail MSB-first so the decoder's bit offsets stay aligned.
    if (filled) bits += (nibble << (4 - filled)).toString(16);

    return { size, bits };
  } catch {
    return undefined;
  }
}

export function toWatchTicket(record: TicketRecord): WatchTicketDTO {
  const status = mapStatus(record);
  return {
    id: record.id,
    eventId: String(record.event_id),
    qrToken: record.qr_token,
    // Only a valid ticket presents a scannable code, and the single WCSession
    // application-context slot is shared with broadcasts — so nothing else pays
    // the ~500 bytes a matrix costs.
    qrMatrix: status === "valid" ? toQRMatrix(record.qr_token) : undefined,
    status,
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
