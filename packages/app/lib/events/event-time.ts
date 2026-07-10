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
 * Formatting uses Intl.DateTimeFormat (Hermes-native, no deps) and always shows
 * a zone abbreviation so "9:00 PM PDT" is never ambiguous.
 */

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

  // event-local → the venue's zone; viewer-local → viewerTz or the device zone
  // (undefined lets Intl use the runtime default = the viewer's device).
  const tzRaw =
    mode === "event-local" ? eventTz || "UTC" : viewerTz || undefined;
  // Guard: an invalid/garbage timeZone makes Intl.DateTimeFormat THROW a
  // RangeError, which would crash the event screen. Fall back to the device
  // zone (no timeZone option) rather than throw.
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short", // "PDT" / "EDT" — never ambiguous
  };
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...opts,
      ...(tzRaw ? { timeZone: tzRaw } : {}),
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", opts).format(d);
  }
}

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
