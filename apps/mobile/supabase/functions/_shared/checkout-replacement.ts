import { retrieveCanceledCheckoutProof } from "./settlement-canceled-proof.ts";
import { checkoutTicketLines } from "./checkout-line-items.ts";

/** Explicit replacement coordinator. All I/O is injected; no automatic writes
 * or transport retries. Authentication is established by the HTTP boundary,
 * then repeated against immutable original ownership by every database RPC.
 */
export interface ReplacementDatabase { rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: any }> }
export interface ReplacementProvider { get(path: string): Promise<any>; post(path: string, body: Record<string, string>, key: string): Promise<any> }
export class CheckoutReplacementError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
const reject = (code = "checkout_outcome_unverified", message = "This checkout needs verification. Do not pay again."): never => { throw new CheckoutReplacementError(code, message); };
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
async function rpc(db: ReplacementDatabase, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    // Only fixed actionable codes cross the boundary, never database/provider
    // messages that could contain an address, secret, or another order ID.
    const text = String(error.message || "");
    if (/quote changed|acceptance mismatch/.test(text)) reject("quote_changed", "The price changed. Review a fresh quote before paying.");
    if (/quote expired/.test(text)) reject("quote_expired", "This quote expired. Review a fresh quote before paying.");
    if (/disabled/.test(text)) throw new CheckoutReplacementError("replacement_unavailable", "Checkout replacement is not available.", 503);
    if (/inventory|capacity|buyer.limit/.test(text)) reject("inventory_unavailable", "Inventory needs review. Do not start another payment.");
    if (/promo quote|addon quote|dynamic quote|access review|absorb fee policy/.test(text)) reject("replacement_review_required", "This selection needs support review before a replacement can be offered.");
    reject();
  }
  if (!data || data.ok !== true) reject();
  return data;
}

/** Build from the newly accepted authoritative snapshot, never the request's
 * amounts or a copied old provider body. The old body contributes only safe
 * fulfillment labels and the already-existing automatic-tax policy.
 */
export function replacementProviderParams(prepared: any, original: any): { hosted: boolean; params: Record<string, string> } {
  const snapshot = prepared?.snapshot; const order = snapshot?.order;
  const hosted = ["ticket-checkout", "guest-checkout"].includes(snapshot?.rail);
  if (!uuid(prepared?.order_id) || !order || !integer(order.total_cents) || order.total_cents < 1 ||
    !integer(order.subtotal_cents) || !integer(order.quantity) || order.quantity < 1 ||
    !/^[a-z]{3}$/.test(order.currency) || !Number.isFinite(Date.parse(prepared.created_at)) ||
    !["ticket-checkout", "guest-checkout", "cart-checkout", "create-payment-intent"].includes(snapshot.rail)) reject();
  const metadata: Record<string, string> = {
    charge_model: "separate_charges_and_transfers", settlement_order_id: prepared.order_id,
    replacement_original_order_id: original.order_id,
    type: snapshot.rail === "cart-checkout" ? "cart_checkout" : "event_ticket",
    event_id: String(order.event_id), quantity: String(order.quantity),
    fee_policy_version: order.fee_policy_version,
    fee_mode: order.buyer_fee_cents === 0 ? "absorb" : "pass",
  };
  for (const key of ["subtotal_cents", "buyer_fee_cents", "organizer_fee_cents", "dvnt_total_fee_cents"]) {
    if (!integer(order[key])) reject(); metadata[key] = String(order[key]);
  }
  if (order.user_id) metadata.user_id = order.user_id;
  else if (order.guest_email) metadata.guest_email = order.guest_email;
  else reject();
  if (snapshot.rail === "cart-checkout") {
    if (!uuid(order.cart_id) || order.cart_id === original.snapshot?.order?.cart_id) reject();
    metadata.cart_id = order.cart_id;
    metadata.line_item_count = String(snapshot.selection?.lines?.length || 0);
  } else {
    if (!uuid(snapshot.selection?.ticket_type_id)) reject();
    metadata.ticket_type_id = snapshot.selection.ticket_type_id;
  }
  if (order.promoter_code) metadata.dvnt_promoter_code = order.promoter_code;
  for (const key of ["guest_name", "attendee_names", "event_title"]) {
    const value = original.stripe_params?.[`metadata[${key}]`];
    if (typeof value === "string" && value.length <= 500) metadata[key] = value;
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    params[`metadata[${key}]`] = value;
    if (hosted) params[`payment_intent_data[metadata][${key}]`] = value;
  }
  if (hosted) {
    const line = checkoutTicketLines(order.subtotal_cents, order.quantity, order.currency, "DVNT tickets");
    Object.assign(params, line.params, { mode: "payment", expires_at: String(Math.floor(Date.parse(prepared.created_at) / 1000) + 3500),
      // UUID randomness supplies an eight-letter comparison suffix, stable for
      // this successor. No new identifier is generated by an HTTP retry.
      integration_identifier: "dvnt_checkout_replacement_" + prepared.order_id.replaceAll("-", "").slice(-8).split("").map((x: string) => String.fromCharCode(97 + parseInt(x, 16))).join(""),
      success_url: `https://dvntapp.live/checkout/replacement-return?orderId=${prepared.order_id}`,
      cancel_url: `https://dvntapp.live/checkout/replacement-return?orderId=${prepared.order_id}&canceled=1` });
    if (order.total_cents !== order.subtotal_cents + order.buyer_fee_cents) reject();
    if (order.buyer_fee_cents > 0) {
      params[`line_items[${line.count}][price_data][currency]`] = order.currency;
      params[`line_items[${line.count}][price_data][unit_amount]`] = String(order.buyer_fee_cents);
      params[`line_items[${line.count}][price_data][product_data][name]`] = "Service fee";
      params[`line_items[${line.count}][quantity]`] = "1";
    }
    if (snapshot.tax_mode === "at_checkout") {
      if (original.stripe_params?.["automatic_tax[enabled]"] !== "true" || snapshot.automatic_tax !== true) reject();
      params["automatic_tax[enabled]"] = "true";
    } else if (original.stripe_params?.["automatic_tax[enabled]"] === "true") reject();
    if (order.guest_email) params.customer_email = order.guest_email;
  } else {
    if (snapshot.tax_mode !== "none") reject();
    Object.assign(params, { amount: String(order.total_cents), currency: order.currency,
      "automatic_payment_methods[enabled]": "true", "automatic_payment_methods[allow_redirects]": "always" });
    // A standalone PaymentSheet/Payment Element does not need a saved-customer
    // capability or a new customer account. No ephemeral keys are requested.
  }
  return { hosted, params };
}

export async function runCheckoutReplacement(db: ReplacementDatabase, provider: ReplacementProvider,
  input: { action: "quote" | "accept"; order_id: string; quote_id?: string; accepted_total_cents?: number; accepted_currency?: string },
  identity: { actorId: string | null; guestSessionHash: string | null }, options: { publishableKey?: string } = {}) {
  if (!uuid(input.order_id) || !["quote", "accept"].includes(input.action) ||
    (!!identity.actorId === !!identity.guestSessionHash)) reject("unauthorized", "Use the original buyer's session.");
  if (input.action === "accept" && (!uuid(input.quote_id) || !integer(input.accepted_total_cents) ||
    Number(input.accepted_total_cents) < 1 || !/^[a-z]{3}$/.test(input.accepted_currency || ""))) reject("invalid_request", "Review the checkout quote first.");
  const auth = { p_actor_id: identity.actorId, p_guest_session_hash: identity.guestSessionHash };
  const context = await rpc(db, "settlement_replacement_context", { p_order_id: input.order_id, ...auth,
    p_replay_quote: input.action === "accept" ? input.quote_id : null });
  // No provider object is retrieved before ownership is established above.
  const proof = await retrieveCanceledCheckoutProof(provider, context);
  if (input.action === "quote") {
    const quote = await rpc(db, "settlement_replacement_quote", { p_order_id: input.order_id, ...auth });
    if (!uuid(quote.quote_id) || quote.original_order_id !== input.order_id || !integer(quote.total_cents) || quote.total_cents < 1 ||
      !/^[a-z]{3}$/.test(quote.currency) || !Number.isFinite(Date.parse(quote.expires_at)) ||
      !["none", "at_checkout"].includes(quote.tax_mode)) reject();
    return { ok: true, quote: { quote_id: quote.quote_id, order_id: input.order_id, total_cents: quote.total_cents,
      previous_total_cents: context.snapshot.order.total_cents, currency: quote.currency,
      expires_at: quote.expires_at, tax_mode: quote.tax_mode, ...(quote.resume_only === true ? { resume_only: true } : {}),
      lines: (quote.snapshot?.replacement_lines || []).map((line: any) => ({ name: line.addon_id ? "Add-on" : "Tickets", quantity: line.quantity, unit_price_cents: line.unit_price_cents })) } };
  }
  const hosted = ["ticket-checkout", "guest-checkout"].includes(context.snapshot.rail);
  if (!hosted && !(context.livemode ? /^pk_live_[A-Za-z0-9]+$/ : /^pk_test_[A-Za-z0-9]+$/).test(options.publishableKey || "")) {
    throw new CheckoutReplacementError("replacement_unavailable", "Checkout replacement is not configured.", 503);
  }
  const accepted = await rpc(db, "settlement_replacement_accept", { p_quote_id: input.quote_id, ...auth,
    p_accepted_total_cents: input.accepted_total_cents, p_accepted_currency: input.accepted_currency,
    p_intent: proof.intent, p_session: proof.session, p_platform_account: proof.platform_account,
    p_livemode: proof.livemode, p_charges: proof.charges.data });
  if (!uuid(accepted.order_id) || accepted.original_order_id !== input.order_id) reject();
  const current = await rpc(db, "settlement_replacement_dispatch_context", { p_order_id: accepted.order_id });
  if (current.status === "paid" || current.status === "processing") return { ok: true, order_id: accepted.order_id, payment: { kind: "pending" } };
  const prepared = { ...accepted, ...current };
  const { params } = replacementProviderParams(prepared, context);
  const savedId = hosted ? prepared.stripe_checkout_session_id : prepared.stripe_payment_intent_id;
  let payment;
  if (savedId) {
    if (!(hosted ? /^cs_[A-Za-z0-9_]+$/ : /^pi_[A-Za-z0-9_]+$/).test(savedId)) reject();
    payment = await provider.get(`/v1/${hosted ? "checkout/sessions" : "payment_intents"}/${encodeURIComponent(savedId)}`);
    if (payment?.id !== savedId) reject();
  } else {
    if (hosted && Number(params.expires_at) < Math.floor(Date.now() / 1000) + 1800) reject();
    const claim = await rpc(db, "claim_settlement_checkout", { p_order_id: accepted.order_id, p_params: params });
    if (claim.claimed !== true || claim.idempotency_key !== accepted.idempotency_key) reject();
    // Exactly one dispatch after the durable claim. A lost response is unknown
    // forever until reconciliation; not a reason to issue a fresh payment.
    payment = await provider.post(`/v1/${hosted ? "checkout/sessions" : "payment_intents"}`, params, claim.idempotency_key);
  }
  const order = prepared.snapshot.order;
  if (!(hosted ? /^cs_[A-Za-z0-9_]+$/ : /^pi_[A-Za-z0-9_]+$/).test(payment?.id || "") ||
    payment.object !== (hosted ? "checkout.session" : "payment_intent") ||
    payment.metadata?.settlement_order_id !== accepted.order_id || payment.metadata?.charge_model !== "separate_charges_and_transfers" ||
    payment.livemode !== proof.livemode || payment.currency !== order.currency ||
    (hosted ? payment.mode !== "payment" || payment.amount_subtotal !== order.total_cents ||
      !integer(payment.total_details?.amount_tax) || payment.total_details.amount_discount !== 0 || payment.total_details.amount_shipping !== 0 ||
      payment.amount_total !== order.total_cents + payment.total_details.amount_tax : payment.amount !== order.total_cents ||
      payment.transfer_data !== null || payment.application_fee_amount !== null || payment.on_behalf_of !== null)) reject();
  await rpc(db, "finalize_settlement_checkout", { p_order_id: accepted.order_id,
    p_payment_intent_id: hosted ? (typeof payment.payment_intent === "string" ? payment.payment_intent : null) : payment.id,
    p_checkout_session_id: hosted ? payment.id : null });
  // Identity must be saved even if a hold landed during the provider request.
  // Recheck eligibility before returning a still-payable secret or redirect.
  // This does not claim to revoke a secret the buyer already received earlier.
  const handoff = await rpc(db, "settlement_replacement_dispatch_context", { p_order_id: accepted.order_id });
  const result = { ok: true, order_id: accepted.order_id, ...(accepted.new_cart_id ? { cart_id: accepted.new_cart_id } : {}) };
  if (handoff.checkout_available !== true) return { ...result, payment: { kind: "pending" } };
  if (hosted) {
    if (payment.status !== "open" || payment.payment_status !== "unpaid") return { ...result, payment: { kind: "pending" } };
    let url: URL; try { url = new URL(payment.url); } catch { return reject(); }
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password) reject();
    return { ...result, payment: { kind: "hosted", url: url.toString() } };
  }
  if (!["requires_payment_method", "requires_confirmation", "requires_action"].includes(payment.status)) return { ...result, payment: { kind: "pending" } };
  if (typeof payment.client_secret !== "string" || !payment.client_secret.startsWith(payment.id + "_secret_")) reject();
  return { ...result, payment: { kind: "payment_sheet", client_secret: payment.client_secret, publishable_key: options.publishableKey } };
}
