/**
 * Async settlement (ACH debit + US bank transfer) — high-ticket rail
 * constants (WS-5).
 *
 * Delayed payment methods settle in days, not seconds. They are only
 * offered on orders at/above the threshold below, because a multi-day
 * `ticket_holds` reservation on a $20 ticket is pure inventory damage,
 * while on a $500+ order the lower processing cost and higher card-
 * decline rates make the trade worth it.
 *
 * Param shapes verified against the Stripe OpenAPI spec
 * (2026-07-29.dahlia; the repo's pinned version 2026-02-25.clover is
 * older but both post-date the 2022 GA of these params):
 *   Checkout Sessions accept payment_method_types[] values
 *   'us_bank_account' and 'customer_balance', with
 *   payment_method_options[customer_balance][funding_type]=bank_transfer
 *   and payment_method_options[customer_balance][bank_transfer][type]=
 *   us_bank_transfer; customer_balance additionally requires a Customer
 *   (customer or customer_creation=always).
 *
 * Hold lifecycle: holds created for async-capable sessions use
 * hold_kind='async_settlement' with a days-scale expires_at (migration
 * 20260806100500's release contract). They are converted by
 * checkout.session.completed / .async_payment_succeeded /
 * payment_intent.succeeded, released early by payment failure webhooks,
 * and backstopped by the reconcile-orders sweep once expires_at passes.
 */

/**
 * Orders at/above this total (cents) get bank-payment methods offered
 * alongside card. $500 — aligned with group-bundle / table-service
 * order sizes where ACH cost savings are material.
 */
export const ASYNC_SETTLEMENT_MIN_TOTAL_CENTS = 50_000;

/**
 * Inventory hold window covering the processor settlement window
 * (ACH debit ~4 business days, bank transfer up to ~5) plus margin.
 */
export const ASYNC_SETTLEMENT_HOLD_DAYS = 7;

/** Bank methods are US-rail only. */
export function qualifiesForAsyncSettlement(
  totalCents: number,
  currency: string,
): boolean {
  return (
    totalCents >= ASYNC_SETTLEMENT_MIN_TOTAL_CENTS &&
    String(currency || "usd").toLowerCase() === "usd"
  );
}

/** expires_at for an async_settlement hold, ISO string. */
export function asyncSettlementHoldExpiresAt(now: number = Date.now()): string {
  return new Date(
    now + ASYNC_SETTLEMENT_HOLD_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}
