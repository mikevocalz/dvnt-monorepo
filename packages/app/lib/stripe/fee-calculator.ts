/**
 * Canonical DVNT Fee Calculator — TypeScript (client-side / React Native)
 *
 * Fee model v1 (fee_policy_version = "v1_250_1pt"):
 *   Buyer pays:     2.5% + $1/ticket (added on top of base price)
 *   Organizer pays: 2.5% + $1/ticket (deducted from payout)
 *   DVNT total:     5%  + $2/ticket
 *
 * RULE: compute each component separately — never compute 5% first.
 * Invariant: customer_charge == organizer_transfer + application_fee
 */

export const FEE_POLICY_VERSION = "v1_250_1pt";

export interface FeeBreakdown {
  subtotal: number;
  qty: number;
  // Buyer side
  buyer_pct_fee: number;
  buyer_per_ticket_fee: number;
  buyer_fee: number;
  // Organizer side
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
    throw new Error(`[FeeCalc] qty must be a positive integer, got: ${qty}`);
  }

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

/** Format cents as a dollar string, e.g. 399 → "$3.99" */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Returns a buyer-facing checkout breakdown string array.
 * Example:
 *   ["Tickets (2×$25.00)", "$50.00"]
 *   ["DVNT Service Fee",   "$2.25"]
 *   ["Total",             "$52.25"]
 */
export interface CheckoutLineItem {
  label: string;
  amount: string;
  note?: string;
}

export function buyerCheckoutLines(
  ticketName: string,
  unitPriceCents: number,
  qty: number,
): CheckoutLineItem[] {
  const subtotal = unitPriceCents * qty;
  const fees = computeFees(subtotal, qty);
  const lines: CheckoutLineItem[] = [
    {
      label:
        qty === 1
          ? `${ticketName}`
          : `${ticketName} (${qty}×${formatCents(unitPriceCents)})`,
      amount: formatCents(fees.subtotal),
    },
    {
      label: "DVNT Service Fee",
      amount: formatCents(fees.buyer_fee),
      note: "2.5% + $1/ticket • Non-refundable",
    },
    {
      label: "Total",
      amount: formatCents(fees.customer_charge_amount),
    },
  ];
  return lines;
}

/**
 * Returns an organizer-facing payout breakdown.
 */
export function organizerPayoutLines(
  grossCents: number,
  qty: number,
): CheckoutLineItem[] {
  const fees = computeFees(grossCents, qty);
  return [
    {
      label: "Gross Revenue",
      amount: formatCents(fees.subtotal),
    },
    {
      label: "DVNT Platform Fee",
      amount: `−${formatCents(fees.organizer_fee)}`,
      note: "2.5% + $1/ticket • Deducted from payout",
    },
    {
      label: "Net Payout",
      amount: formatCents(fees.organizer_transfer_amount),
    },
  ];
}
