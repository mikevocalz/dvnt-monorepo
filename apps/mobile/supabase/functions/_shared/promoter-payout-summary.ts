/** Reporting only. A ledger settlement is not evidence of a bank payout. */
export interface PromoterPayoutRow {
  amount_cents: number;
  payout_status: string;
  paid_out_at: string | null;
  stripe_transfer_id: string | null;
  entry_type: string;
}

export function promoterPayoutSummary(rows: PromoterPayoutRow[], eventStatus: string | null) {
  let settledCents = 0;
  let unsettledCents = 0;
  let heldCents = 0;
  let hasRecordedTransfer = false;
  let hasUnsettled = false;
  let hasHeld = false;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.amount_cents) ||
      !["pending", "held", "paid"].includes(row.payout_status) ||
      (row.payout_status === "paid") !== !!row.paid_out_at) {
      return null; // A partial/inconsistent write must not look like a payment.
    }
    if (row.payout_status === "paid") {
      settledCents += row.amount_cents;
      hasRecordedTransfer ||= row.entry_type === "earning" && !!row.stripe_transfer_id;
    } else {
      hasUnsettled = true;
      unsettledCents += row.amount_cents;
      if (row.payout_status === "held") {
        hasHeld = true;
        heldCents += row.amount_cents;
      }
    }
  }
  if (![settledCents, unsettledCents, heldCents].every(Number.isSafeInteger)) return null;
  return {
    settledCents, unsettledCents, heldCents, hasRecordedTransfer,
    status: rows.length === 0 ? "no_earnings"
      : hasHeld || (hasUnsettled && eventStatus === "on_hold") ? "held"
      : hasUnsettled ? "pending" : "settled",
  };
}
