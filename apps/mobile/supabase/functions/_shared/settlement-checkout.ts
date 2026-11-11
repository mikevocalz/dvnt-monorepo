/** Disabled-default adapter: reserve immutable economics before creating a charge.
 * A database claim authorizes exactly one provider create attempt. Ambiguous
 * outcomes require reconciliation, never another create, regardless of age.
 */
export class SettlementCheckoutError extends Error {
  readonly status = 409;
}
export interface SettlementCheckout {
  orderId: string;
  model: "separate_charges_and_transfers";
  idempotencyKey: string;
  createdAt: string;
  paymentIntentId: string | null;
  checkoutSessionId: string | null;
  amount: number;
  currency: string;
}
export async function prepareSettlementCheckout(db: any, snapshot: {rail: string; order: Record<string, any>; selection?: Record<string, unknown>}, requestKey: string | null | undefined): Promise<SettlementCheckout | null> {
  const eventId = Number(snapshot.order.event_id);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) throw new SettlementCheckoutError("Checkout route unavailable");
  // Reviewed per-event cohort is the routing authority, never a fresh key or
  // current deployment flag. The migration is an explicit deployment dependency:
  // missing/stale schema and read failures must not silently select legacy.
  const {data: route, error: routeError} = await db.rpc("settlement_checkout_route", {p_event_id: eventId});
  if (routeError || route?.ok !== true || !["destination_charge", "separate_charges_and_transfers"].includes(route.charge_model)) {
    throw new SettlementCheckoutError("Checkout route unavailable; do not retry another payment");
  }
  if (route.charge_model === "destination_charge") return null;
  if (Deno.env.get("TICKET_SEPARATE_CHARGES_ENABLED") !== "true") {
    throw new SettlementCheckoutError("Checkout for this event is paused; the original payment must not be replaced automatically");
  }
  if (!requestKey || !/^[A-Za-z0-9:_-]{16,128}$/.test(requestKey)) {
    throw new SettlementCheckoutError("A checkout request key is required");
  }
  const {data, error} = await db.rpc("prepare_settlement_checkout", {p_snapshot: snapshot, p_request_key: requestKey});
  if (error || data?.ok !== true || typeof data.order_id !== "string" || !data.order_id ||
      data.charge_model !== "separate_charges_and_transfers" || typeof data.idempotency_key !== "string" || !data.idempotency_key ||
      !Number.isFinite(Date.parse(data.created_at))) {
    throw new SettlementCheckoutError("Separate-charge checkout is unavailable or requires reconciliation");
  }
  return {orderId: data.order_id, model: data.charge_model, idempotencyKey: data.idempotency_key,
    createdAt: data.created_at, paymentIntentId: data.stripe_payment_intent_id || null,
    checkoutSessionId: data.stripe_checkout_session_id || null,
    amount: snapshot.order.total_cents, currency: String(snapshot.order.currency).toLowerCase()};
}
export function settlementStripeParams(prepared: SettlementCheckout | null, params: Record<string,string>, hosted: boolean): Record<string,string> {
  if (!prepared) return params;
  const result = {...params};
  delete result["transfer_data[destination]"]; delete result.application_fee_amount;
  delete result["payment_intent_data[transfer_data][destination]"]; delete result["payment_intent_data[application_fee_amount]"];
  result["metadata[charge_model]"] = prepared.model;
  result["metadata[settlement_order_id]"] = prepared.orderId;
  if (hosted) {
    result["payment_intent_data[metadata][charge_model]"] = prepared.model;
    result["payment_intent_data[metadata][settlement_order_id]"] = prepared.orderId;
    result.expires_at = String(Math.floor(Date.parse(prepared.createdAt)/1000)+3600);
  }
  return result;
}
export async function settlementProviderObject(db: any, prepared: SettlementCheckout | null, params: Record<string,string>, hosted: boolean,
  create: (idempotencyKey?: string) => Promise<any>): Promise<any> {
  if (!prepared) return create();
  const ref = hosted ? prepared.checkoutSessionId : prepared.paymentIntentId;
  let provider;
  if (ref) {
    const prefix = hosted ? "cs_" : "pi_";
    if (!new RegExp(`^${prefix}[A-Za-z0-9_]+$`).test(ref)) throw new SettlementCheckoutError("Invalid saved payment reference");
    const response = await fetch(`https://api.stripe.com/v1/${hosted?"checkout/sessions":"payment_intents"}/${ref}`, {
      headers: {Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY") || ""}`},
    });
    if (!response.ok) throw new SettlementCheckoutError("Could not verify saved payment");
    provider = await response.json();
    if (provider.id !== ref) throw new SettlementCheckoutError("Saved payment reference mismatch");
  } else {
    if (hosted && Number(params.expires_at) <= Math.floor(Date.now()/1000)+1800) {
      throw new SettlementCheckoutError("Checkout attempt expired; reconciliation is required");
    }
    const {data,error} = await db.rpc("claim_settlement_checkout", {p_order_id: prepared.orderId, p_params: params});
    if (error || data?.ok !== true || data.claimed !== true || data.idempotency_key !== prepared.idempotencyKey) {
      throw new SettlementCheckoutError("Checkout creation is already in progress or requires reconciliation");
    }
    provider = await create(prepared.idempotencyKey);
  }
  if (typeof provider?.id !== "string" || !provider.id.startsWith(hosted?"cs_":"pi_") ||
      provider.metadata?.settlement_order_id !== prepared.orderId || provider.metadata?.charge_model !== prepared.model ||
      provider.currency?.toLowerCase() !== prepared.currency ||
      (hosted ? provider.amount_subtotal !== prepared.amount ||
        !Number.isSafeInteger(provider.total_details?.amount_tax) || provider.total_details.amount_tax < 0 ||
        provider.total_details.amount_discount !== 0 || provider.total_details.amount_shipping !== 0 ||
        provider.amount_total !== prepared.amount + provider.total_details.amount_tax : provider.amount !== prepared.amount) ||
      (!hosted && (provider.transfer_data?.destination || provider.application_fee_amount != null))) {
    throw new SettlementCheckoutError("Payment does not match the saved checkout");
  }
  if (hosted ? provider.status !== "open" || typeof provider.url !== "string" : !["requires_payment_method","requires_confirmation","requires_action"].includes(provider.status) || typeof provider.client_secret !== "string") {
    throw new SettlementCheckoutError("Payment is no longer available for checkout");
  }
  return provider;
}
export async function finalizeSettlementCheckout(db: any, prepared: SettlementCheckout | null, refs: {paymentIntentId?: string | null; checkoutSessionId?: string | null}): Promise<void> {
  if (!prepared) return;
  const {data,error} = await db.rpc("finalize_settlement_checkout", {p_order_id: prepared.orderId,
    p_payment_intent_id: refs.paymentIntentId || null,p_checkout_session_id: refs.checkoutSessionId || null});
  if (error || data?.ok !== true) throw new SettlementCheckoutError("Could not link the saved checkout; reconciliation is required");
}
