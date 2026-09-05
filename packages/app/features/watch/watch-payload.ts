/**
 * Projects the app's ticket records into the compact DTO the Apple Watch consumes.
 * Mirrors `apps/mobile/targets/watch/Models.swift` (WatchTicket / WatchTicketEnvelope)
 * — keep the two in lockstep.
 *
 * The watch is a presenter: it renders `qrToken` byte-identical to the phone
 * (see docs/watch-app-fit.md). Nothing here is signed or rotated.
 */

import type { TicketRecord } from "@dvnt/app/lib/api/tickets";
import { normalizeHex } from "@dvnt/app/lib/color/normalizeColor";
import { getPlan } from "@dvnt/app/lib/subscription/plans";
import type { Entitlements } from "@dvnt/app/lib/subscription/types";

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
  /**
   * The event's flyer colour, `#rrggbb`. ~7 bytes, and it is the ONLY piece of
   * artwork that is guaranteed present offline — which is why it is the primary
   * fix for a blank wrist, not the image below.
   *
   * A paired-but-unreachable watch has no network path of its own, and
   * `AsyncImage` writes nothing into the watch App Group, so it can never be
   * offline-first. Nor can the bytes ride along here: `Models.swift` documents
   * the single WCSession applicationContext slot as size-capped and "precious"
   * (it is shared with broadcasts, DMs and door counts). A hex fits in that
   * budget forever. The hex is the guarantee; the art is the upgrade.
   */
  dominantHex?: string;
  /**
   * A WATCH-SIZED rendition of the flyer (~200x200 @2x) — progressive
   * enhancement only, drawn over `dominantHex` when the wrist happens to have a
   * route to the CDN. NEVER the full flyer.
   *
   * CAVEAT, verified not assumed: this repo has no watch-rendition helper to
   * reuse. Bunny Optimizer is OFF on the `dvnt.b-cdn.net` pull zone — `?width=`
   * returns the byte-identical original (see the header of
   * `packages/app/lib/media/resolve-renderable.ts`), and every stored thumbnail
   * column in production is NULL. Fabricating a transform here is exactly the
   * bug an earlier backfill shipped (`?thumb=true` "thumbnails" that were the
   * whole video). So this carries the existing cover URL unchanged, and the
   * watch treats it as best-effort. When a real rendition pipeline lands, point
   * this one line at it and the wrist gets small art for free.
   */
  imageURL?: string;
  /**
   * False when the ticket row belongs to someone else — a pass bought for the
   * member and still held under the buyer's account. The watch says so out
   * loud rather than implying every code on the wrist is the wearer's own.
   * Undefined means we could not resolve identity; the watch then says nothing.
   */
  isOwner?: boolean;
}

/**
 * The member's resolved capabilities, flattened to the handful that change what
 * someone physically does at a door.
 *
 * This is a **projection of `Entitlements`**, which the resolver derives from
 * Supabase subscription rows written by the Stripe / RevenueCat webhooks. The
 * watch therefore inherits invariant I3 for free: it can no more read a
 * processor SDK than the phone can, because it only ever sees this object.
 * Nothing here is a client guess, and nothing here is re-derived on the watch.
 */
export interface WatchMembershipDTO {
  /** "Free" | "Core" | "Insider" | "VIP" | "Founders Circle" | Sneaky tiers. */
  planLabel: string;
  memberBadge: boolean;
  priorityRsvp: boolean;
  earlyTicketAccess: boolean;
  vipAdmission: boolean;
  /** VIP: skip the general line. The single most useful fact on a wrist. */
  expeditedEntry: boolean;
  coatCheck: boolean;
}

export interface WatchTicketEnvelope {
  protocol?: 2;
  accountGen?: string;
  tickets: WatchTicketDTO[];
  /** Epoch seconds, stamped by the phone so the watch shows honest staleness. */
  syncedAt: number;
  /** Absent until entitlements have resolved — never defaulted to Free, which
   *  would flash "no perks" at a paying VIP on every cold start. */
  membership?: WatchMembershipDTO;
}

/** Flatten resolved entitlements into the door-relevant subset. */
export function toWatchMembership(ent: Entitlements): WatchMembershipDTO {
  return {
    planLabel: getPlan(ent.planKey).name,
    memberBadge: ent.memberBadge,
    priorityRsvp: ent.priorityRsvp,
    earlyTicketAccess: ent.earlyTicketAccess,
    vipAdmission: ent.vipAdmission,
    expeditedEntry: ent.expeditedEntry,
    coatCheck: ent.coatCheck,
  };
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

export function toWatchTicket(
  record: TicketRecord,
  viewerId?: string | null,
): WatchTicketDTO {
  const status = mapStatus(record);
  return {
    isOwner: viewerId ? record.user_id === viewerId : undefined,
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
    // Normalised through the same coercion every other surface uses, so the
    // wrist and the phone never disagree about what "#FFF" meant. Undefined
    // (not a brand default) when the column is unset — the watch renders its
    // own flat surface rather than a colour we invented for it.
    dominantHex: normalizeHex(record.event_dominant_color) ?? undefined,
    // The cover as stored. See `imageURL` on the DTO for why there is no
    // rendition transform here.
    imageURL: record.event_image?.trim() || undefined,
  };
}

/** What the phone knows about the viewer when it builds an envelope. */
export interface WatchViewerContext {
  /** Resolved entitlements. Omit while still loading — see `membership`. */
  entitlements?: Entitlements;
  /** The signed-in user id, for owner-vs-guest resolution. */
  viewerId?: string | null;
}

/**
 * Build the envelope. Only admission-style tickets belong on the wrist — coat
 * check / product / service rows aren't scanned at the door.
 *
 * One-way projection: this reads phone state and emits a DTO. The watch never
 * writes back, so there is exactly one source of truth and the wrist is a pure
 * view of it.
 */
export function buildWatchEnvelope(
  records: TicketRecord[],
  ctx: WatchViewerContext = {},
): WatchTicketEnvelope {
  const tickets = records
    .filter((r) => !r.category || r.category === "admission")
    .map((r) => toWatchTicket(r, ctx.viewerId));
  return {
    tickets,
    syncedAt: Math.floor(Date.now() / 1000),
    membership: ctx.entitlements ? toWatchMembership(ctx.entitlements) : undefined,
  };
}

/**
 * Stable signature to skip redundant pushes. Covers the membership projection
 * too — an upgrade to VIP must reach the wrist even when no ticket changed.
 *
 * Artwork is part of the signature for the same reason: `dominant_color` is
 * backfilled lazily (first viewer extracts it and writes it back), so it
 * usually arrives on a poll where nothing else about the ticket moved. Left
 * out, the wrist would keep the blank card until an unrelated status flip.
 * The hex is 7 characters and the URL is compared by presence only.
 */
export function envelopeSignature(env: WatchTicketEnvelope): string {
  const tickets = env.tickets
    .map(
      (t) =>
        `${t.id}:${t.status}:${t.qrToken}:${t.isOwner ?? "?"}:${
          t.dominantHex ?? "-"
        }:${t.imageURL ? "1" : "0"}`,
    )
    .sort()
    .join("|");
  const m = env.membership;
  const plan = m
    ? `${m.planLabel}:${[
        m.memberBadge,
        m.priorityRsvp,
        m.earlyTicketAccess,
        m.vipAdmission,
        m.expeditedEntry,
        m.coatCheck,
      ].join(",")}`
    : "-";
  return `${plan}#${tickets}`;
}
