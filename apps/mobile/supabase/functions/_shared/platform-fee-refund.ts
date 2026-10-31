/** Scoped application-fee snapshots. GET-only Stripe reads; never refunds,
 * changes orders, or scans payments. Only explicitly enrolled rows are claimed.
 * Stripe references: /api/application_fees/object, /api/charges/object.
 */
export type PlatformFeeEvidence = { amountCents: number; refundedCents: number; currency: string };
function idOf(value: any): string | null { return typeof value === "string" ? value : typeof value?.id === "string" ? value.id : null; }
function cents(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }

/** Unsupported rails/missing evidence are unknown, never a zero refund. */
export async function fetchPlatformFeeEvidence(secret: string, row: {
  payment_intent_id: string; expected_fee_cents: number; currency: string;
}, deadline = Date.now() + 4000): Promise<PlatformFeeEvidence | null> {
  if (!secret || !/^pi_[A-Za-z0-9]+$/.test(row.payment_intent_id) ||
      !cents(row.expected_fee_cents) || row.expected_fee_cents === 0 || row.currency !== "usd") return null;
  async function get(path: string): Promise<any | null> {
    try {
      const remaining = Math.min(4000, deadline - Date.now());
      if (remaining <= 0) return null;
      const response = await fetch(`https://api.stripe.com/v1${path}`, {
        method: "GET", headers: {Authorization: `Bearer ${secret}`},
        signal: AbortSignal.timeout(Math.max(1, Math.floor(remaining))),
      });
      if (!response.ok) return null;
      const body = await response.json();
      return body && !body.error ? body : null;
    } catch { return null; }
  }
  const pi = await get(`/payment_intents/${encodeURIComponent(row.payment_intent_id)}?expand[]=latest_charge.application_fee`);
  if (!pi || pi.id !== row.payment_intent_id || pi.status !== "succeeded" || pi.currency !== row.currency) return null;
  let charge = pi.latest_charge;
  if (typeof charge === "string" && /^ch_[A-Za-z0-9]+$/.test(charge)) {
    charge = await get(`/charges/${encodeURIComponent(charge)}?expand[]=application_fee`);
  }
  // Destination charges belong to the platform. Never guess a connected-account
  // header for direct charges or treat separate transfers as application fees.
  if (!charge || typeof charge !== "object" || !/^ch_[A-Za-z0-9]+$/.test(charge.id || "") ||
      idOf(charge.payment_intent) !== row.payment_intent_id || charge.currency !== row.currency ||
      charge.paid !== true || charge.status !== "succeeded" || !idOf(charge.transfer_data?.destination)) return null;
  const feeId = idOf(charge.application_fee);
  if (!feeId || !/^fee_[A-Za-z0-9]+$/.test(feeId)) return null;
  let fee = charge.application_fee;
  if (typeof fee === "string") fee = await get(`/application_fees/${encodeURIComponent(feeId)}`);
  // A destination fee's `charge` can refer to its connected-side charge;
  // `originating_transaction` identifies the platform-side charge instead.
  if (!fee || fee.object !== "application_fee" || fee.id !== feeId || fee.currency !== row.currency ||
      idOf(fee.account) !== idOf(charge.transfer_data.destination) ||
      (idOf(fee.charge) !== charge.id && idOf(fee.originating_transaction) !== charge.id) ||
      !cents(fee.amount) || fee.amount !== row.expected_fee_cents || !cents(fee.amount_refunded) ||
      fee.amount_refunded > fee.amount) return null;
  return {amountCents: fee.amount, refundedCents: fee.amount_refunded, currency: fee.currency};
}

/** Existing authenticated reconciliation worker calls this; no enrollment here.
 * SQL claim revalidates the owner and full payment cohort before any GET.
 */
export async function reconcilePlatformFeeSnapshots(db: any, secret: string): Promise<{verified: number; unavailable: number}> {
  if (!secret) return {verified: 0, unavailable: 0};
  const totals = {verified: 0, unavailable: 0};
  const deadline = Date.now() + 20_000;
  let processed = 0;
  // Claim only the next concurrently serviced group, never lease a backlog
  // which this invocation has no time to process. Stop on either budget.
  while (processed < 100 && Date.now() < deadline) {
    const claimed = await db.rpc("claim_platform_fee_snapshots", {p_limit: 4});
    if (claimed.error || !Array.isArray(claimed.data)) throw new Error("Fee snapshot queue unavailable");
    if (claimed.data.length === 0) break;
    processed += claimed.data.length;
    await Promise.all(claimed.data.map(async (row: any) => {
      const evidence = await fetchPlatformFeeEvidence(secret, row, Math.min(deadline, Date.now() + 4000));
      const done = await db.rpc("complete_platform_fee_snapshot", {
        p_payment_intent_id: row.payment_intent_id, p_lease: row.lease_token,
        p_amount_cents: evidence?.amountCents ?? null,
        p_refunded_cents: evidence?.refundedCents ?? null,
        p_currency: evidence?.currency ?? null,
        p_error: evidence ? null : "provider_evidence_unavailable",
      });
      if (evidence && !done.error && done.data === true) totals.verified++;
      else totals.unavailable++;
    }));
  }
  return totals;
}
