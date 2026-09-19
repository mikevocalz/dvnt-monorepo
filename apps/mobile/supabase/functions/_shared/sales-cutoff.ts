/**
 * Sales cutoff: tickets stop being purchasable / RSVP-able 30 minutes
 * before an event ends. After that point the only legitimate way to sell
 * is card-present (Tap to Pay / Terminal) — card-not-present rails
 * (hosted checkout, PaymentIntent, cart, guest RSVP, auth RSVP, and the
 * web Door POS link) all refuse.
 *
 * Anchor is `end_date`; events without one anchor on `start_date`
 * (their sales window closes 30 min before doors — set an end_date on
 * the event if staff need to sell through the night).
 */

export const SALES_CUTOFF_MINUTES = 30;

interface EventDates {
  end_date?: string | null;
  start_date?: string | null;
  date?: string | null;
}

export function salesCutoffAt(event: EventDates | null | undefined): Date | null {
  const anchor = event?.end_date ?? event?.start_date ?? event?.date;
  if (!anchor) return null;
  const t = new Date(anchor).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t - SALES_CUTOFF_MINUTES * 60_000);
}

export function isSalesClosed(
  event: EventDates | null | undefined,
  now: number = Date.now(),
): boolean {
  const cutoff = salesCutoffAt(event);
  return cutoff !== null && now >= cutoff.getTime();
}
