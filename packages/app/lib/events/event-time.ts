/**
 * Timezone-correct event scheduling & display.
 *
 * Storage is UTC-only (events.start_date / end_date are timestamptz). `event_tz`
 * is IANA display metadata, NEVER used for math. ALL comparisons / state gates
 * run on the absolute UTC instant, so a transition is identical regardless of
 * where the server or viewer sits.
 *
 * Display resolves per event type:
 *   - physical  (is_online=false) → event-local  (venue zone = event_tz)
 *   - streamed  (is_online=true)  → viewer-local (device zone)
 *
 * Formatting uses Intl.DateTimeFormat (Hermes-native, no deps) and shows a
 * zone abbreviation ("9:00 PM PDT") whenever the zone is known. A row with no
 * recorded zone renders in the viewer's zone without a label (displayZone).
 */

import { normalizeTimeZone } from "./event-zone.ts";

export type EventDisplayMode = "event-local" | "viewer-local";

/** Single source of truth for display mode. Streamed → viewer's zone. */
export function resolveDisplayMode(event: {
  is_online?: boolean | null;
  isOnline?: boolean | null;
}): EventDisplayMode {
  const online = event?.is_online ?? event?.isOnline ?? false;
  return online ? "viewer-local" : "event-local";
}

/**
 * Format an absolute UTC instant for display.
 * @param startsAtUtc ISO string / Date / epoch-ms — the absolute instant.
 * @param eventTz     IANA zone for event-local display (e.g. America/Los_Angeles).
 * @param mode        'event-local' → eventTz; 'viewer-local' → viewerTz or device.
 * @param viewerTz    Optional override for the viewer zone (defaults to the
 *                    runtime/device zone). Mainly for tests + SSR determinism.
 */
export function formatEventTime(
  startsAtUtc: string | number | Date,
  eventTz: string | null | undefined,
  mode: EventDisplayMode,
  viewerTz?: string,
): string {
  const d = startsAtUtc instanceof Date ? startsAtUtc : new Date(startsAtUtc);
  if (isNaN(d.getTime())) return "";
  const zone = displayZone(eventTz, mode, viewerTz);
  return formatIn(d, zone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Which zone to render in, and whether to label it.
 *
 * event-local with a real zone: that zone, labelled ("9:00 PM PDT").
 * event-local with no zone (null, "", garbage): the viewer's device zone with
 * NO label. These are older rows whose creator zone was never recorded;
 * labelling them "UTC" (the old fallback) printed a zone nobody chose.
 * viewer-local: the viewer's zone, labelled, since it is the viewer's own.
 */
export function displayZone(
  eventTz: string | null | undefined,
  mode: EventDisplayMode,
  viewerTz?: string,
): { timeZone: string | undefined; label: boolean } {
  if (mode === "event-local") {
    const tz = normalizeTimeZone(eventTz);
    return tz ? { timeZone: tz, label: true } : { timeZone: undefined, label: false };
  }
  return { timeZone: normalizeTimeZone(viewerTz) ?? undefined, label: true };
}

function formatIn(
  d: Date,
  zone: { timeZone: string | undefined; label: boolean },
  opts: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-US", {
    ...opts,
    ...(zone.label ? { timeZoneName: "short" as const } : {}),
    ...(zone.timeZone ? { timeZone: zone.timeZone } : {}),
  }).format(d);
}

/** Event fields the display helpers read. Accepts DB rows and client shapes. */
export interface EventZoneFields {
  event_tz?: string | null;
  eventTz?: string | null;
  is_online?: boolean | null;
  isOnline?: boolean | null;
}

function zoneFor(event: EventZoneFields | null | undefined, viewerTz?: string) {
  return displayZone(
    event?.event_tz ?? event?.eventTz,
    resolveDisplayMode(event ?? {}),
    viewerTz,
  );
}

/** Time of day with the zone: "8:00 PM PDT". No label when the zone is unknown. */
export function formatEventClock(
  instant: string | number | Date | null | undefined,
  event: EventZoneFields | null | undefined,
  viewerTz?: string,
): string {
  if (instant == null) return "";
  const d = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(d.getTime())) return "";
  return formatIn(d, zoneFor(event, viewerTz), { hour: "numeric", minute: "2-digit" });
}

/**
 * Calendar day in the same zone as formatEventClock, so a 10 PM Pacific event
 * is not shown on the next day to someone in New York.
 */
export function formatEventDay(
  instant: string | number | Date | null | undefined,
  event: EventZoneFields | null | undefined,
  opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" },
  viewerTz?: string,
): string {
  if (instant == null) return "";
  const d = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(d.getTime())) return "";
  const zone = zoneFor(event, viewerTz);
  return formatIn(d, { timeZone: zone.timeZone, label: false }, opts);
}

/** "Fri, Jul 10 at 8:00 PM PDT": day and time, both in the event's zone. */
export function formatEventWhen(
  instant: string | number | Date | null | undefined,
  event: EventZoneFields | null | undefined,
  viewerTz?: string,
): string {
  const day = formatEventDay(instant, event, undefined, viewerTz);
  const clock = formatEventClock(instant, event, viewerTz);
  return day && clock ? `${day} at ${clock}` : "";
}

/**
 * True when both instants parse and the end is strictly before the start.
 * Same rule as the events_end_not_before_start constraint and create-event.
 */
export function endsBeforeStart(
  start: string | number | Date | null | undefined,
  end: string | number | Date | null | undefined,
): boolean {
  const s = ms(start);
  const e = ms(end);
  return s != null && e != null && e < s;
}

export const END_BEFORE_START_ERROR =
  "The event ends before it starts. Set an end time after the start.";

// ── Time gates — operate PURELY on UTC instants (never formatted strings) ──
// Used by the event/ticket lifecycle state machines so a transition fires at
// the correct absolute instant regardless of viewer or server timezone.

function ms(instant: string | number | Date | null | undefined): number | null {
  if (instant == null) return null;
  const t = (instant instanceof Date ? instant : new Date(instant)).getTime();
  return isNaN(t) ? null : t;
}

/** Sale window open at `now` (UTC ms). Null bound = unbounded on that side. */
export function saleWindowOpen(
  saleStart: string | number | Date | null | undefined,
  saleEnd: string | number | Date | null | undefined,
  now: number = Date.now(),
): boolean {
  const s = ms(saleStart);
  const e = ms(saleEnd);
  if (s != null && now < s) return false;
  if (e != null && now >= e) return false;
  return true;
}

/** Doors open — now is within `leadMs` before start, through end (or start). */
export function doorsOpen(
  startsAtUtc: string | number | Date,
  endsAtUtc: string | number | Date | null | undefined,
  now: number = Date.now(),
  leadMs: number = 0,
): boolean {
  const s = ms(startsAtUtc);
  if (s == null) return false;
  const e = ms(endsAtUtc) ?? s;
  return now >= s - leadMs && now <= e;
}

/** Event is live now (started, not yet ended; end defaults to start). */
export function isLive(
  startsAtUtc: string | number | Date,
  endsAtUtc: string | number | Date | null | undefined,
  now: number = Date.now(),
): boolean {
  const s = ms(startsAtUtc);
  if (s == null) return false;
  const e = ms(endsAtUtc) ?? s;
  return now >= s && now <= e;
}

/** Event is over (past its end, or its start when no end). */
export function isPast(
  startsAtUtc: string | number | Date,
  endsAtUtc: string | number | Date | null | undefined,
  now: number = Date.now(),
): boolean {
  const e = ms(endsAtUtc) ?? ms(startsAtUtc);
  return e != null && now > e;
}

// ── Sales cutoff ────────────────────────────────────────────────────────────
// Client mirror of apps/mobile/supabase/functions/_shared/sales-cutoff.ts —
// the anchor chain and the 30-minute lead MUST stay identical or the UI will
// offer a "Buy" button the server then refuses. Anchor: end → start+6h → date.

export const SALES_CUTOFF_MINUTES = 30;

/**
 * Assumed run-time when the row has no end_date — most rows don't carry
 * one. Same convention as get_events_home
 * (COALESCE(end_date, start_date + interval '6 hours')) and
 * ticket-library's ASSUMED_EVENT_LENGTH_MS; must match _shared/sales-cutoff.ts.
 */
export const ASSUMED_EVENT_LENGTH_MS = 6 * 60 * 60 * 1000;

interface EventTimingFields {
  endDate?: string | null;
  end_date?: string | null;
  startDate?: string | null;
  start_date?: string | null;
  fullDate?: string | null;
  date?: string | null;
}

/** End anchor as UTC ms (null when the event carries no usable dates). */
export function eventEndAt(
  event: EventTimingFields | null | undefined,
): number | null {
  // `date` on card-shaped objects is the day-of-month chip ("05"), not an
  // ISO stamp — only treat it as a date when it actually looks like one.
  const rawDate = event?.date;
  const dateMs =
    rawDate && /[-/T]/.test(rawDate) ? ms(rawDate) : null;
  const end = ms(event?.endDate ?? event?.end_date);
  if (end != null) return end;
  // No stored end → assume a six-hour event rather than ending at doors.
  const start = ms(event?.startDate ?? event?.start_date ?? event?.fullDate);
  return start != null ? start + ASSUMED_EVENT_LENGTH_MS : dateMs;
}

/** Event is over (past its end anchor). */
export function eventEnded(
  event: EventTimingFields | null | undefined,
  now: number = Date.now(),
): boolean {
  const end = eventEndAt(event);
  return end != null && now >= end;
}

/**
 * Card-not-present sales/RSVPs are closed — 30 min before the end anchor,
 * same rule the checkout/RSVP edge functions enforce. Tap to Pay is the
 * only carve-out and never consults this.
 */
export function eventSalesClosed(
  event: EventTimingFields | null | undefined,
  now: number = Date.now(),
): boolean {
  const end = eventEndAt(event);
  return end != null && now >= end - SALES_CUTOFF_MINUTES * 60_000;
}
