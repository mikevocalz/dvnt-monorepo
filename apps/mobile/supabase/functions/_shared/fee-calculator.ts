/**
 * Canonical DVNT Fee Calculator — Deno (Edge Function runtime)
 *
 * Fee model v1 (fee_policy_version = "v1_250_1pt"):
 *   Buyer pays:     2.5% + $1/ticket (on top of base price)
 *   Organizer pays: 2.5% + $1/ticket (deducted from their payout)
 *   DVNT total:     5%  + $2/ticket
 *
 * CRITICAL RULE: compute buyer_pct and org_pct SEPARATELY then sum.
 * NEVER compute 5% first — rounding on the combined value creates drift.
 *
 * Invariant: customer_charge_amount == organizer_transfer_amount + application_fee_amount
 */

export const FEE_POLICY_VERSION = "v1_250_1pt";

/**
 * Minimum tier price (cents) that produces a non-negative organizer payout
 * under the current fee policy. Computed exactly for v1_250_1pt:
 *   subtotal - (round(subtotal * 0.025) + 100) >= 0
 *   subtotal * 0.975 - 100 >= 0  (within rounding)
 *   subtotal >= ~103
 * Padded to 200¢ for a comfortable margin and to discourage near-zero
 * pricing that would produce a humiliatingly small organizer payout
 * (e.g. $1.05 ticket → ~$0.02 to organizer after fees, not worth it).
 */
export const MIN_TIER_PRICE_CENTS = 200;

export interface FeeBreakdown {
  subtotal: number;
  qty: number;
  // Buyer side (added on top of base price)
  buyer_pct_fee: number;
  buyer_per_ticket_fee: number;
  buyer_fee: number;
  // Organizer side (deducted from payout)
  org_pct_fee: number;
  org_per_ticket_fee: number;
  organizer_fee: number;
  // DVNT total
  dvnt_total_fee: number;
  // Stripe amounts
  customer_charge_amount: number;
  organizer_transfer_amount: number;
  application_fee_amount: number;
  fee_policy_version: string;
}

export function computeFees(subtotal: number, qty: number): FeeBreakdown {
  if (!Number.isInteger(subtotal) || subtotal < 0) {
    throw new Error(
      `[FeeCalc] subtotal must be a non-negative integer (cents), got: ${subtotal}`,
    );
  }
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error(
      `[FeeCalc] qty must be a positive integer, got: ${qty}`,
    );
  }

  // Compute each percentage component SEPARATELY — never combine percentages before rounding
  const buyer_pct_fee = Math.round(subtotal * 0.025);
  const buyer_per_ticket_fee = qty * 100;
  const buyer_fee = buyer_pct_fee + buyer_per_ticket_fee;

  const org_pct_fee = Math.round(subtotal * 0.025);
  const org_per_ticket_fee = qty * 100;
  const organizer_fee = org_pct_fee + org_per_ticket_fee;

  const dvnt_total_fee = buyer_fee + organizer_fee;

  const customer_charge_amount = subtotal + buyer_fee;
  const organizer_transfer_amount = subtotal - organizer_fee;
  const application_fee_amount = dvnt_total_fee;

  // Invariant: what the customer pays equals what the organizer gets plus what DVNT keeps
  const delta =
    customer_charge_amount - (organizer_transfer_amount + application_fee_amount);
  if (delta !== 0) {
    throw new Error(
      `[FeeCalc] INVARIANT VIOLATED: customer_charge(${customer_charge_amount}) != ` +
        `transfer(${organizer_transfer_amount}) + app_fee(${application_fee_amount}), delta=${delta}`,
    );
  }

  if (organizer_transfer_amount < 0) {
    throw new Error(
      `[FeeCalc] organizer_transfer_amount is negative (${organizer_transfer_amount}). ` +
        `Ticket base price is too low to cover organizer fee.`,
    );
  }

  return {
    subtotal,
    qty,
    buyer_pct_fee,
    buyer_per_ticket_fee,
    buyer_fee,
    org_pct_fee,
    org_per_ticket_fee,
    organizer_fee,
    dvnt_total_fee,
    customer_charge_amount,
    organizer_transfer_amount,
    application_fee_amount,
    fee_policy_version: FEE_POLICY_VERSION,
  };
}

/** Format cents as a human-readable dollar string, e.g. 399 → "$3.99" */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
