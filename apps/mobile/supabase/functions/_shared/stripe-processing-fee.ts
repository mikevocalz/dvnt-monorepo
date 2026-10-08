/**
 * Stripe processing-fee synchronization.
 *
 * DVNT's application/platform fee and Stripe's processor fee are different
 * ledgers. Stripe's actual processor fee comes from the Charge balance
 * transaction and must never be inferred from DVNT's fee policy.
 *
 * The fee lands in orders.stripe_fee_cents, never processing_fee_cents:
 * processing_fee_cents is the buyer-facing "Processing" receipt line and is
 * subtracted from host net in host-transactions. Stripe's fee is platform
 * accounting and must not show up in either place.
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

/**
 * Splits one PaymentIntent's fee across the orders it paid for, pro rata by
 * total_cents. Integer cents; the rounding remainder goes to the last order
 * so the parts always sum to feeCents. Orders with no total share equally.
 */
export function allocateStripeFeeCents(
  feeCents: number,
  orders: Array<{ id: string; total_cents?: number | null }>,
): Array<{ id: string; feeCents: number }> {
  if (orders.length === 0) return [];
  const weights = orders.map((o) => Math.max(0, Number(o.total_cents) || 0));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const shares = weightSum > 0 ? weights : orders.map(() => 1);
  const shareSum = weightSum > 0 ? weightSum : orders.length;

  let allocated = 0;
  return orders.map((order, i) => {
    const part = i === orders.length - 1
      ? feeCents - allocated
      : Math.floor((feeCents * shares[i]) / shareSum);
    allocated += part;
    return { id: order.id, feeCents: part };
  });
}

export interface StripeFeeSyncRefs {
  orderId?: string | null;
  paymentIntentId?: string | null;
  checkoutSessionId?: string | null;
}

/**
 * Persist Stripe's processor fee on the event-ticket orders paid by one
 * PaymentIntent. event_financials refreshes through the orders trigger.
 * Idempotent: orders that already carry a stripe_fee_cents are left alone.
 * Returns the PaymentIntent's total fee, or null when nothing was written.
 */
export async function syncOrderStripeProcessingFee(
  db: any,
  secret: string,
  refs: StripeFeeSyncRefs,
): Promise<number | null> {
  let anchor = db
    .from("orders")
    .select("id,stripe_payment_intent_id,stripe_checkout_session_id")
    .eq("type", "event_ticket");

  if (refs.orderId) anchor = anchor.eq("id", refs.orderId);
  else if (refs.checkoutSessionId) {
    anchor = anchor.eq("stripe_checkout_session_id", refs.checkoutSessionId);
  } else if (refs.paymentIntentId) {
    anchor = anchor.eq("stripe_payment_intent_id", refs.paymentIntentId);
  } else {
    return null;
  }

  const { data: anchorRows, error: anchorError } = await anchor;
  if (anchorError) {
    console.error("[stripe-processing-fee] order lookup failed:", anchorError.message);
    return null;
  }
  const anchors = Array.isArray(anchorRows) ? anchorRows : [];
  if (anchors.length === 0) return null;

  const paymentIntentId =
    refs.paymentIntentId ||
    anchors.map((o: any) => idOf(o.stripe_payment_intent_id)).find(Boolean) ||
    null;
  if (!paymentIntentId) return null;

  // Every event-ticket order this PaymentIntent paid for shares its fee.
  const { data: siblingRows, error: siblingError } = await db
    .from("orders")
    .select("id,total_cents,stripe_fee_cents")
    .eq("type", "event_ticket")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (siblingError) {
    console.error("[stripe-processing-fee] order lookup failed:", siblingError.message);
    return null;
  }
  // An order stamped by session id but not yet by PI still belongs to it.
  const byId = new Map<string, any>();
  for (const row of [...(siblingRows || []), ...anchors]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  const orders = [...byId.values()];
  if (orders.every((o: any) => Number.isInteger(o.stripe_fee_cents))) {
    return null;
  }

  const feeCents = await fetchStripeProcessingFeeCents(secret, paymentIntentId);
  if (feeCents === null) return null;

  const now = new Date().toISOString();
  for (const part of allocateStripeFeeCents(feeCents, orders)) {
    if (Number.isInteger(byId.get(part.id)?.stripe_fee_cents)) continue;
    const { error: updateError } = await db
      .from("orders")
      .update({ stripe_fee_cents: part.feeCents, stripe_fee_attempted_at: now })
      .eq("id", part.id)
      .is("stripe_fee_cents", null);
    if (updateError) {
      console.error("[stripe-processing-fee] order update failed:", updateError.message);
      return null;
    }
  }

  console.log(
    `[stripe-processing-fee] PI ${paymentIntentId}: Stripe processing fee = ${feeCents}¢ over ${orders.length} order(s)`,
  );
  return feeCents;
}

/**
 * Webhook-safe wrapper. Fee sync is accounting, never fulfillment: any
 * failure, including fetch throwing, is logged and swallowed.
 */
export async function syncOrderStripeProcessingFeeSafely(
  db: any,
  secret: string,
  refs: StripeFeeSyncRefs,
): Promise<number | null> {
  try {
    return await syncOrderStripeProcessingFee(db, secret, refs);
  } catch (err) {
    console.error(
      "[stripe-processing-fee] sync failed (ignored):",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
