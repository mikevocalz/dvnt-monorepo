/**
 * Sales cutoff: tickets stop being purchasable / RSVP-able 30 minutes
 * before an event ends. After that point the only legitimate way to sell
 * is card-present (Tap to Pay / Terminal) — card-not-present rails
 * (hosted checkout, PaymentIntent, cart, guest RSVP, auth RSVP, and the
 * web Door POS link) all refuse.
 *
 * Anchor is `end_date`; events without one are assumed to run six hours
 * (the get_events_home / ticket-library convention — most rows have no
 * end_date), so sales close 30 min before the assumed end rather than 30
 * min before doors. `date` is the legacy last resort.
 */

export const SALES_CUTOFF_MINUTES = 30;

/** Assumed run-time when events.end_date is NULL — keep in sync with
 *  COALESCE(end_date, start_date + interval '6 hours') in the RPCs. */
export const ASSUMED_EVENT_LENGTH_MS = 6 * 60 * 60 * 1000;

interface EventDates {
  end_date?: string | null;
  start_date?: string | null;
  date?: string | null;
}

export function salesCutoffAt(event: EventDates | null | undefined): Date | null {
  const anchor = event?.end_date ?? event?.start_date ?? event?.date;
  if (!anchor) return null;
  let t = new Date(anchor).getTime();
  if (!Number.isFinite(t)) return null;
  // Anchored on start_date with no stored end → assume a six-hour event.
  if (event?.end_date == null && event?.start_date != null)
    t += ASSUMED_EVENT_LENGTH_MS;
  return new Date(t - SALES_CUTOFF_MINUTES * 60_000);
}

export function isSalesClosed(
  event: EventDates | null | undefined,
  now: number = Date.now(),
): boolean {
  const cutoff = salesCutoffAt(event);
  return cutoff !== null && now >= cutoff.getTime();
}
