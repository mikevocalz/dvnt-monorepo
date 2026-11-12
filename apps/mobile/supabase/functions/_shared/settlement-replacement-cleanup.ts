import { retrieveCanceledCheckoutProof, type CancellationContext } from "./settlement-canceled-proof.ts";

/** Default-off replacement inventory lifecycle. The deadline authorizes an
 * attempt to close an unpaid payment, not an inference that payment failed.
 * Unknown writes are never resent. Only exact final evidence releases stock.
 */
type Database = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: any }> };
type Provider = { assertCanStart?(): void; get(path: string): Promise<any>; post(path: string, body: Record<string, string>, key: string): Promise<any> };
const numeric = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const ref = (v: any) => typeof v === "string" ? v : v?.id;
async function rpc(db: Database, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error || data == null || data.ok === false) throw Error("Replacement cleanup verification unavailable");
  return data;
}
async function observe(db: Database, orderId: string, reason: string) {
  await rpc(db, "settlement_replacement_cleanup_observe", { p_order_id: orderId, p_reason: reason });
  return { order_id: orderId, state: "attention", reason };
}

/** Strict pre-cancel read. Cancellation is limited to currently unsubmitted,
 * uncharged intents, never processing or authorized/capturable payments.
 * Hosted intents belong to Checkout: only expire the bound session, not a
 * direct PI cancellation that could violate the provider's ownership model.
 */
async function readForCancellation(provider: Provider, context: CancellationContext) {
  if (!/^pi_[A-Za-z0-9_]+$/.test(context.stripe_payment_intent_id || "")) throw Error("provider_link_missing");
  const hosted = ["ticket-checkout", "guest-checkout"].includes(context.snapshot.rail);
  if (hosted ? !/^cs_[A-Za-z0-9_]+$/.test(context.stripe_checkout_session_id || "") : context.stripe_checkout_session_id !== null) throw Error("provider_link_missing");
  const account = await provider.get("/v1/account");
  if (account?.object !== "account" || account.id !== context.platform_account || typeof context.livemode !== "boolean") throw Error("proof_unavailable");
  let gross = context.snapshot.order.total_cents;
  if (!numeric(gross) || gross < 1 || !/^[a-z]{3}$/.test(context.snapshot.order.currency)) throw Error("proof_unavailable");
  const metadata = (v: any) => v?.metadata?.settlement_order_id === context.order_id && v?.metadata?.charge_model === "separate_charges_and_transfers";
  let session: any = null;
  if (hosted) {
    const value = await provider.get(`/v1/checkout/sessions/${encodeURIComponent(context.stripe_checkout_session_id!)}`);
    const tax = value?.total_details?.amount_tax;
    if (value?.object !== "checkout.session" || value.id !== context.stripe_checkout_session_id || value.mode !== "payment" ||
      value.livemode !== context.livemode || !metadata(value) || value.currency !== context.snapshot.order.currency ||
      value.amount_subtotal !== gross || !numeric(tax) || value.total_details.amount_discount !== 0 || value.total_details.amount_shipping !== 0 ||
      !Number.isSafeInteger(gross + tax) || value.amount_total !== gross + tax || ref(value.payment_intent) !== context.stripe_payment_intent_id ||
      value.payment_status !== "unpaid" || !["open", "expired"].includes(value.status)) throw Error("payment_or_financial_review");
    gross += tax;
    session = { id: value.id, object: value.object, mode: value.mode, status: value.status, payment_status: value.payment_status,
      livemode: value.livemode, currency: value.currency, amount_subtotal: value.amount_subtotal, amount_total: value.amount_total,
      total_details: { amount_tax: tax, amount_discount: 0, amount_shipping: 0 }, payment_intent: context.stripe_payment_intent_id,
      metadata: { settlement_order_id: context.order_id, charge_model: "separate_charges_and_transfers" } };
  }
  const value = await provider.get(`/v1/payment_intents/${encodeURIComponent(context.stripe_payment_intent_id!)}?expand[]=latest_charge`);
  if (value?.object !== "payment_intent" || value.id !== context.stripe_payment_intent_id || value.livemode !== context.livemode ||
    !metadata(value) || value.amount !== gross || value.currency !== context.snapshot.order.currency || value.amount_received !== 0 ||
    value.amount_capturable !== 0 || value.latest_charge !== null || value.transfer_data !== null || value.application_fee_amount !== null || value.on_behalf_of !== null) throw Error("payment_or_financial_review");
  if (value.status === "processing") throw Error("processing");
  if (!["requires_payment_method", "requires_confirmation", "requires_action", "canceled"].includes(value.status)) throw Error("payment_or_financial_review");
  const charges = await provider.get(`/v1/charges?payment_intent=${encodeURIComponent(value.id)}&limit=100`);
  if (charges?.object !== "list" || charges.has_more !== false || !Array.isArray(charges.data) || charges.data.length !== 0) throw Error("payment_or_financial_review");
  const intent = { id: value.id, object: value.object, status: value.status, amount: value.amount, currency: value.currency,
    amount_received: 0, amount_capturable: 0, latest_charge: null, livemode: value.livemode, transfer_data: null,
    application_fee_amount: null, on_behalf_of: null, canceled_at: value.canceled_at,
    metadata: { settlement_order_id: context.order_id, charge_model: "separate_charges_and_transfers" } };
  return { intent, session, platform_account: account.id, livemode: context.livemode };
}

export async function reconcileReplacementInventoryOrder(db: Database, provider: Provider, orderId: string) {
  try {
    const context = await rpc(db, "settlement_replacement_cleanup_context", { p_order_id: orderId });
    if (context.terminal === true) return { order_id: orderId, state: context.state };
    if (context.never_dispatched === true) {
      const released = await rpc(db, "settlement_replacement_cleanup_release", { p_order_id: orderId });
      return { order_id: orderId, state: released.state };
    }
    const current = await readForCancellation(provider, context);
    if (current.intent.status !== "canceled") {
      // An expired hosted session with a nonterminal intent is contradictory,
      // not permission to cancel that Checkout-owned PI or expire a second time.
      if (current.session?.status === "expired") return observe(db, orderId, "payment_or_financial_review");
      if (context.cleanup_attempted === true) return observe(db, orderId, "cancellation_outcome_unknown");
      provider.assertCanStart?.();
      const claim = await rpc(db, "settlement_replacement_cleanup_claim", { p_order_id: orderId,
        p_intent: current.intent, p_session: current.session, p_platform_account: current.platform_account,
        p_livemode: current.livemode, p_charges: [] });
      if (claim.claimed !== true) return observe(db, orderId, "cancellation_outcome_unknown");
      const hosted = current.session !== null;
      const expected = hosted ? context.stripe_checkout_session_id : context.stripe_payment_intent_id;
      if (claim.action !== (hosted ? "expire_session" : "cancel_intent") || claim.provider_object_id !== expected ||
        claim.idempotency_key !== `dvnt:replacement-cleanup:v1:${orderId}`) throw Error("proof_unavailable");
      // No retry middleware. Claim persists even if this request never arrives,
      // times out, or succeeds while its response is lost.
      await provider.post(`/v1/${hosted ? "checkout/sessions" : "payment_intents"}/${encodeURIComponent(expected)}/${hosted ? "expire" : "cancel"}`, {}, claim.idempotency_key);
    }
    // Ignore the mutation response. Only fresh exact retrieval proves release.
    const final = await retrieveCanceledCheckoutProof(provider, context);
    const result = await rpc(db, "settlement_replacement_cleanup_release", { p_order_id: orderId,
      p_intent: final.intent, p_session: final.session, p_platform_account: final.platform_account,
      p_livemode: final.livemode, p_charges: final.charges.data });
    return { order_id: orderId, state: result.state };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    const reason = ["processing", "provider_link_missing", "payment_or_financial_review", "cancellation_outcome_unknown"].includes(raw) ? raw : "proof_unavailable";
    return observe(db, orderId, reason);
  }
}

export async function reconcileReplacementInventoryCleanup(db: Database, provider: Provider, { limit = 10, budgetMs = 20000 } = {}) {
  const candidates = await rpc(db, "settlement_replacement_cleanup_candidates", { p_limit: Math.max(1, Math.min(20, limit)) });
  if (!Array.isArray(candidates)) throw Error("Invalid replacement cleanup queue");
  const deadline = Date.now() + Math.max(1000, Math.min(60000, budgetMs));
  const results = [];
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    if (typeof candidate.order_id !== "string" || !/^[a-f0-9-]{36}$/i.test(candidate.order_id)) throw Error("Invalid replacement cleanup candidate");
    results.push(await reconcileReplacementInventoryOrder(db, provider, candidate.order_id));
  }
  const health = await rpc(db, "settlement_replacement_cleanup_health", {});
  return { checked: results.length, released: results.filter(r => ["released", "not_dispatched"].includes(r.state)).length,
    attention: results.filter(r => r.state === "attention").length, health };
}
