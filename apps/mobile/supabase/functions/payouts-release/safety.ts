/** Conservative release preflight. No charge-model inference from missing data. */
export async function checkedWrite(query: any, expectedRows = 1): Promise<void> {
  const { data, error } = await query.select("id");
  if (error) throw error;
  if (!data || data.length !== expectedRows) throw new Error("Settlement write did not match expected rows");
}

export async function assertSafeRelease(db: any, eventId: number): Promise<number> {
  // The new per-order ledger owns these obligations, including unpaid checkout
  // reservations. Aggregate settlement must never pay any part of this event.
  const { data: ownership, error: ownershipError } = await db.rpc("settlement_legacy_event_eligible", { p_event_id: eventId });
  if (ownershipError || ownership?.eligible !== true) {
    throw new Error("Per-order settlement owns this event or ownership cannot be verified");
  }
  // The aggregate event summary cannot isolate historical destination funding.
  // Reject the whole event instead of transferring an incorrectly prorated sum.
  // Fetch one beyond the bound and fail closed, never silently truncate money.
  const { data: orders, error: orderError } = await db.from("orders")
    .select("id, charge_model, total_cents, currency")
    .eq("event_id", eventId).limit(1001);
  if (orderError) throw orderError;
  if (!orders || orders.length >= 1000) throw new Error("Order set requires reconciliation");
  let verifiedGrossCents = 0;
  for (const order of orders) {
    if (!Number.isSafeInteger(order.total_cents) || order.total_cents < 0) {
      throw new Error("Invalid order amount; reconciliation required");
    }
    verifiedGrossCents += order.total_cents;
    if (!Number.isSafeInteger(verifiedGrossCents)) throw new Error("Invalid total amount");
    if (order.total_cents === 0) continue;
    if (order.charge_model !== "separate_charges_and_transfers") {
      throw new Error("Destination or unknown charge model; reconciliation required");
    }
    if (order.currency?.toLowerCase() !== "usd") {
      throw new Error("Unsupported settlement currency; reconciliation required");
    }
  }
  const { data: payouts, error: payoutError } = await db.from("payouts")
    .select("id").eq("event_id", eventId).limit(1);
  if (payoutError) throw payoutError;
  if (!payouts || payouts.length) throw new Error("Prior payout requires reconciliation");

  const { data: ledger, error: ledgerError } = await db.from("promoter_ledger_entries")
    .select("id, paid_out_at, stripe_transfer_id, payout_status")
    .eq("event_id", eventId).limit(1001);
  if (ledgerError) throw ledgerError;
  if (!ledger || ledger.length >= 1000) throw new Error("Promoter ledger requires reconciliation");
  if (ledger.some((row: any) => row.paid_out_at || row.stripe_transfer_id || row.payout_status === "paid")) {
    // Settled cuts must never disappear from the organizer deduction on retry.
    throw new Error("Prior promoter settlement requires reconciliation");
  }
  return verifiedGrossCents;
}
