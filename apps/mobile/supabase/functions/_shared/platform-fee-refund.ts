/** Scoped application-fee snapshots. GET-only Stripe reads; never refunds,
 * changes orders, or scans payments. Only explicitly enrolled rows are claimed.
 * Stripe references: /api/application_fees/object, /api/charges/object.
 */
/** Per invocation, not an account-wide Stripe quota. Shared by every fallback GET.
 * Leave room below the 120s dispatcher timeout / 150s Edge idle limit.
 */
export const PLATFORM_FEE_WORKER_LIMITS = Object.freeze({
  items: 400, durationMs: 110_000, concurrency: 4, getsPerSecond: 12,
  requestMs: 4_000, rowMs: 12_000, databaseMs: 3_000, completionReserveMs: 5_000,
});
type Runtime = { now: () => number; sleep: (ms: number) => Promise<void> };
const runtime: Runtime = { now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };

/** One rolling-window gate for all concurrently processed snapshots. A 429 from
 * any request pauses subsequent starts, including the charge/fee fallbacks.
 * There is no inline retry: the lease completion retains SQL retry/backoff.
 */
function providerGate(clock: Runtime) {
  const starts: number[] = [];
  let blockedUntil = 0, consecutive429 = 0;
  return {
    async acquire(deadline: number) {
      while (clock.now() < deadline) {
        const now = clock.now();
        while (starts.length && starts[0] <= now - 1000) starts.shift();
        const at = Math.max(blockedUntil, starts.length >= PLATFORM_FEE_WORKER_LIMITS.getsPerSecond ? starts[0] + 1000 : now);
        if (at >= deadline) return false;
        if (at > now) { await clock.sleep(at - now); continue; }
        starts.push(now); // No await between checking and reserving a start.
        return true;
      }
      return false;
    },
    rateLimited(response: Response) {
      consecutive429++;
      const value = response.headers?.get("retry-after")?.trim();
      const seconds = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : NaN;
      const date = value ? Date.parse(value) : NaN;
      const fallback = Math.min(30_000, 1000 * 2 ** Math.min(consecutive429 - 1, 5));
      const delay = Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? date - clock.now() : fallback;
      blockedUntil = Math.max(blockedUntil, clock.now() + Math.max(1000, delay));
    },
    succeeded() { consecutive429 = 0; },
    async ready(deadline: number) {
      if (blockedUntil >= deadline) return false;
      if (blockedUntil > clock.now()) await clock.sleep(blockedUntil - clock.now());
      return clock.now() < deadline;
    },
  };
}
type ProviderGate = ReturnType<typeof providerGate>;

export type PlatformFeeEvidence = { amountCents: number; refundedCents: number; currency: string };
function idOf(value: any): string | null { return typeof value === "string" ? value : typeof value?.id === "string" ? value.id : null; }
function cents(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }

/** Unsupported rails/missing evidence are unknown, never a zero refund. */
export async function fetchPlatformFeeEvidence(secret: string, row: {
  payment_intent_id: string; expected_fee_cents: number; currency: string;
}, deadline = Date.now() + 4000, gate?: ProviderGate, clock: Runtime = runtime): Promise<PlatformFeeEvidence | null> {
  if (!secret || !/^pi_[A-Za-z0-9]+$/.test(row.payment_intent_id) ||
      !cents(row.expected_fee_cents) || row.expected_fee_cents === 0 || row.currency !== "usd") return null;
  async function get(path: string): Promise<any | null> {
    try {
      if (gate && !await gate.acquire(deadline)) return null;
      const remaining = Math.min(PLATFORM_FEE_WORKER_LIMITS.requestMs, deadline - clock.now());
      if (remaining <= 0) return null;
      const response = await fetch(`https://api.stripe.com/v1${path}`, {
        method: "GET", redirect: "error", headers: {Authorization: `Bearer ${secret}`},
        signal: AbortSignal.timeout(Math.max(1, Math.floor(remaining))),
      });
      if (response.status === 429) gate?.rateLimited(response);
      if (!response.ok) return null;
      gate?.succeeded();
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

/** Dedicated authenticated reporting-only worker calls this; no enrollment here.
 * SQL claim revalidates the owner and full payment cohort before any GET.
 */
export async function reconcilePlatformFeeSnapshots(db: any, secret: string, clock: Runtime = runtime): Promise<{verified: number; unavailable: number}> {
  if (!secret) return {verified: 0, unavailable: 0};
  const totals = {verified: 0, unavailable: 0};
  const limits = PLATFORM_FEE_WORKER_LIMITS;
  const deadline = clock.now() + limits.durationMs;
  const providerDeadline = deadline - limits.completionReserveMs;
  const claimDeadline = providerDeadline - limits.databaseMs - limits.requestMs;
  const gate = providerGate(clock);
  let processed = 0, databaseFailed = false;
  // Abort the actual PostgREST fetch, and bound await even if an adapter ignores
  // cancellation. No new claim is made after an uncertain DB result: its lease
  // will expire normally, and another invocation can safely resume the queue.
  async function rpc(operation: (signal: AbortSignal) => PromiseLike<any>) {
    const remaining = Math.min(limits.databaseMs, deadline - clock.now());
    if (remaining <= 0) throw new Error("Reporting deadline exceeded");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Reporting database timeout")); }, remaining);
    });
    try { return await Promise.race([operation(controller.signal), timeout]); }
    finally { clearTimeout(timer!); }
  }
  // Only claim the next concurrently serviced group, never lease a backlog.
  while (processed < limits.items && clock.now() < claimDeadline && !databaseFailed) {
    if (!await gate.ready(claimDeadline)) break;
    let claimed;
    try {
      claimed = await rpc(signal => db.rpc("claim_platform_fee_snapshots", {p_limit: Math.min(limits.concurrency, limits.items - processed)}, signal));
      if (claimed.error || !Array.isArray(claimed.data)) throw new Error("Fee snapshot queue unavailable");
    } catch (error) {
      if (processed === 0) throw error;
      break; // Keep already completed progress; never restart the frozen cohort.
    }
    if (claimed.data.length > limits.concurrency || new Set(claimed.data.map((row: any) => row?.payment_intent_id)).size !== claimed.data.length ||
        claimed.data.some((row: any) => !row || typeof row !== "object" || Array.isArray(row) ||
          typeof row.payment_intent_id !== "string" || !/^pi_[A-Za-z0-9]+$/.test(row.payment_intent_id) ||
          !cents(row.expected_fee_cents) || row.expected_fee_cents === 0 || row.currency !== "usd" ||
          typeof row.lease_token !== "string" || !row.lease_token.trim())) {
      throw new Error("Fee snapshot claim contract invalid");
    }
    if (claimed.data.length === 0) break;
    processed += claimed.data.length;
    await Promise.all(claimed.data.map(async (row: any) => {
      const evidence = await fetchPlatformFeeEvidence(secret, row, Math.min(providerDeadline, clock.now() + limits.rowMs), gate, clock);
      try {
        const done = await rpc(signal => db.rpc("complete_platform_fee_snapshot", {
          p_payment_intent_id: row.payment_intent_id, p_lease: row.lease_token,
          p_amount_cents: evidence?.amountCents ?? null,
          p_refunded_cents: evidence?.refundedCents ?? null,
          p_currency: evidence?.currency ?? null,
          p_error: evidence ? null : "provider_evidence_unavailable",
        }, signal));
        if (done.error) databaseFailed = true;
        if (evidence && !done.error && done.data === true) totals.verified++;
        else totals.unavailable++;
      } catch {
        databaseFailed = true;
        totals.unavailable++;
      }
    }));
  }
  return totals;
}
