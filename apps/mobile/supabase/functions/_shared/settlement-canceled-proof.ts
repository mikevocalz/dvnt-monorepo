/** Necessary provider evidence, never authorization to charge again.
 * Call only after server-side original-buyer authentication. The acceptance
 * transaction must repeat identity, financial-history and inventory checks.
 * No searches, writes, cancellation calls, secrets or buyer PII in the proof.
 */
export interface CancellationContext {
  order_id: string;
  snapshot: { rail: string; order: { currency: string; total_cents: number } };
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  platform_account: string;
  livemode: boolean;
}
export interface CancellationReader { get(path: string): Promise<any> }
export class CancellationProofError extends Error {
  readonly code = "checkout_outcome_unverified";
}
const fail = (): never => { throw new CancellationProofError("The original payment requires verification before replacement."); };
const record = (v: any): boolean => !!v && typeof v === "object" && !Array.isArray(v);
const nonnegative = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const ref = (v: any) => typeof v === "string" ? v : record(v) ? v.id : null;
const model = "separate_charges_and_transfers";

/** Deliberately stricter than polling retirement: any charge history is held
 * for review, including failed charges. A zero-result search is never used to
 * discover or infer cancellation. Only the exact bound canceled PI qualifies.
 */
export async function retrieveCanceledCheckoutProof(provider: CancellationReader, context: CancellationContext) {
  const hosted = ["ticket-checkout", "guest-checkout"].includes(context?.snapshot?.rail);
  if (!record(context) || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(context.order_id) ||
    !["ticket-checkout", "guest-checkout", "cart-checkout", "create-payment-intent"].includes(context.snapshot?.rail) ||
    !/^acct_[A-Za-z0-9_]+$/.test(context.platform_account) || typeof context.livemode !== "boolean" ||
    !/^pi_[A-Za-z0-9_]+$/.test(context.stripe_payment_intent_id || "") ||
    (hosted ? !/^cs_[A-Za-z0-9_]+$/.test(context.stripe_checkout_session_id || "") : context.stripe_checkout_session_id !== null) ||
    !/^[a-z]{3}$/.test(context.snapshot?.order?.currency) ||
    !nonnegative(context.snapshot?.order?.total_cents) || context.snapshot.order.total_cents <= 0) fail();
  const account = await provider.get("/v1/account");
  if (account?.object !== "account" || account.id !== context.platform_account) fail();
  const metadata = (value: any) => record(value?.metadata) &&
    value.metadata.settlement_order_id === context.order_id && value.metadata.charge_model === model;
  let gross = context.snapshot.order.total_cents;
  let session: any = null;
  if (hosted) {
    const value = await provider.get(`/v1/checkout/sessions/${encodeURIComponent(context.stripe_checkout_session_id!)}`);
    const tax = value?.total_details?.amount_tax;
    if (!record(value) || value.object !== "checkout.session" || value.id !== context.stripe_checkout_session_id ||
      value.mode !== "payment" || value.livemode !== context.livemode || !metadata(value) ||
      value.status !== "expired" || value.payment_status !== "unpaid" ||
      ref(value.payment_intent) !== context.stripe_payment_intent_id ||
      value.currency !== context.snapshot.order.currency || value.amount_subtotal !== gross ||
      !nonnegative(tax) || value.total_details.amount_discount !== 0 || value.total_details.amount_shipping !== 0 ||
      !Number.isSafeInteger(gross + tax) || value.amount_total !== gross + tax) fail();
    gross += tax;
    session = { id: value.id, object: value.object, mode: value.mode, status: value.status,
      payment_status: value.payment_status, payment_intent: context.stripe_payment_intent_id,
      livemode: value.livemode, currency: value.currency, amount_subtotal: value.amount_subtotal,
      amount_total: value.amount_total, total_details: { amount_tax: tax, amount_discount: 0, amount_shipping: 0 },
      metadata: { settlement_order_id: context.order_id, charge_model: model } };
  }
  const value = await provider.get(`/v1/payment_intents/${encodeURIComponent(context.stripe_payment_intent_id!)}?expand[]=latest_charge`);
  if (!record(value) || value.object !== "payment_intent" || value.id !== context.stripe_payment_intent_id ||
    value.status !== "canceled" || value.livemode !== context.livemode || !metadata(value) ||
    value.amount !== gross || value.currency !== context.snapshot.order.currency ||
    value.amount_received !== 0 || value.amount_capturable !== 0 || value.latest_charge !== null ||
    !nonnegative(value.canceled_at) || value.canceled_at === 0 ||
    value.transfer_data !== null || value.application_fee_amount !== null || value.on_behalf_of !== null) fail();
  // This exact-intent list confirms absence of historical charge evidence. It
  // cannot make an unbound, active or missing intent safe. Any pagination or
  // charge result blocks rather than truncating or guessing at prior capture.
  const charges = await provider.get(`/v1/charges?payment_intent=${encodeURIComponent(value.id)}&limit=100`);
  if (!record(charges) || charges.object !== "list" || charges.has_more !== false ||
    !Array.isArray(charges.data) || charges.data.length !== 0) fail();
  const intent = { id: value.id, object: value.object, status: value.status, livemode: value.livemode,
    amount: value.amount, amount_received: 0, amount_capturable: 0, currency: value.currency,
    latest_charge: null, canceled_at: value.canceled_at, transfer_data: null, application_fee_amount: null,
    on_behalf_of: null, metadata: { settlement_order_id: context.order_id, charge_model: model } };
  return { intent, session, platform_account: account.id as string, livemode: context.livemode,
    charges: { object: "list", data: [], has_more: false }, observed_at: new Date().toISOString() };
}
