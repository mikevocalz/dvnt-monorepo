/**
 * Stripe processing-fee synchronization.
 *
 * DVNT's application/platform fee and Stripe's processor fee are different
 * ledgers. Stripe's actual processor fee comes from the Charge balance
 * transaction and must never be inferred from DVNT's fee policy.
 */

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof (value as any).id === "string") {
    return (value as any).id;
  }
  return null;
}

function feeFromExpandedCharge(charge: any): number | null {
  const bt = charge?.balance_transaction;
  const fee = bt && typeof bt === "object" ? Number(bt.fee) : Number.NaN;
  return Number.isInteger(fee) && fee >= 0 ? fee : null;
}

async function stripeGet(secret: string, path: string): Promise<any | null> {
  if (!secret) return null;
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) {
    console.error(
      "[stripe-processing-fee] Stripe read failed:",
      res.status,
      body?.error?.message ?? "unknown error",
    );
    return null;
  }
  return body;
}

/**
 * Returns Stripe's ACTUAL processing fee in cents for one PaymentIntent.
 * Uses latest_charge.balance_transaction.fee, not a percentage estimate.
 */
export async function fetchStripeProcessingFeeCents(
  secret: string,
  paymentIntent: string | Record<string, any> | null | undefined,
): Promise<number | null> {
  const paymentIntentId = idOf(paymentIntent);
  if (!paymentIntentId) return null;

  let pi: any =
    paymentIntent && typeof paymentIntent === "object" ? paymentIntent : null;

  const expandedFee = feeFromExpandedCharge(pi?.latest_charge);
  if (expandedFee !== null) return expandedFee;

  pi = await stripeGet(
    secret,
    `/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`,
  );
  if (!pi) return null;

  const fee = feeFromExpandedCharge(pi.latest_charge);
  if (fee !== null) return fee;

  // Defensive fallback if Stripe/API version leaves latest_charge as an ID.
  const chargeId = idOf(pi.latest_charge);
  if (!chargeId) return null;
  const charge = await stripeGet(
    secret,
    `/charges/${encodeURIComponent(chargeId)}?expand[]=balance_transaction`,
  );
  return feeFromExpandedCharge(charge);
}

export interface StripeFeeSyncRefs {
  orderId?: string | null;
  paymentIntentId?: string | null;
  checkoutSessionId?: string | null;
}

/**
 * Persist Stripe's processor fee on the matching event-ticket order and refresh
 * event_financials. Idempotent: an already-positive fee is returned unchanged.
 */
export async function syncOrderStripeProcessingFee(
  db: any,
  secret: string,
  refs: StripeFeeSyncRefs,
): Promise<number | null> {
  let query = db
    .from("orders")
    .select("id,event_id,processing_fee_cents,stripe_payment_intent_id")
    .eq("type", "event_ticket");

  if (refs.orderId) query = query.eq("id", refs.orderId);
  else if (refs.paymentIntentId) {
    query = query.eq("stripe_payment_intent_id", refs.paymentIntentId);
  } else if (refs.checkoutSessionId) {
    query = query.eq("stripe_checkout_session_id", refs.checkoutSessionId);
  } else {
    return null;
  }

  const { data: order, error: orderError } = await query.maybeSingle();
  if (orderError) {
    console.error("[stripe-processing-fee] order lookup failed:", orderError.message);
    return null;
  }
  if (!order) return null;

  const existing = Number(order.processing_fee_cents);
  if (Number.isInteger(existing) && existing > 0) return existing;

  const paymentIntentId =
    refs.paymentIntentId || idOf(order.stripe_payment_intent_id);
  if (!paymentIntentId) return null;

  const feeCents = await fetchStripeProcessingFeeCents(
    secret,
    paymentIntentId,
  );
  if (feeCents === null) return null;

  const { error: updateError } = await db
    .from("orders")
    .update({
      processing_fee_cents: feeCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (updateError) {
    console.error("[stripe-processing-fee] order update failed:", updateError.message);
    return null;
  }

  if (order.event_id != null) {
    const { error: financialError } = await db.rpc(
      "recompute_event_financials",
      { p_event_id: order.event_id },
    );
    if (financialError) {
      console.error(
        "[stripe-processing-fee] event financial refresh failed:",
        financialError.message,
      );
    }
  }

  console.log(
    `[stripe-processing-fee] order ${order.id}: Stripe processing fee = ${feeCents}¢`,
  );
  return feeCents;
}
