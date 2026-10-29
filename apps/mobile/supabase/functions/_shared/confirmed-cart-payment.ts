/** Current payment evidence, not an old webhook snapshot, gates cart recovery. */
export async function confirmCartPayment(intent: { id?: string; metadata?: { cart_id?: string } }) {
  if (!intent.id || !/^pi_[A-Za-z0-9_]+$/.test(intent.id) || !intent.metadata?.cart_id) {
    throw new Error("Cart payment reference is missing");
  }
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Stripe payment verification is unavailable");
  const response = await fetch(
    `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(intent.id)}?expand[]=latest_charge`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  const current = await response.json();
  if (!response.ok || current.error) throw new Error("Stripe payment verification failed");
  const charge = current.latest_charge;
  if (current.id !== intent.id || current.status !== "succeeded" ||
      current.metadata?.type !== "cart_checkout" ||
      current.metadata?.cart_id !== intent.metadata.cart_id ||
      !current.metadata?.user_id || !/^[1-9]\d*$/.test(current.metadata?.event_id ?? "") ||
      !Number.isSafeInteger(current.amount) || current.amount <= 0 ||
      current.amount_received !== current.amount || !/^[a-z]{3}$/.test(current.currency ?? "") ||
      !charge || typeof charge !== "object" || charge.payment_intent !== current.id ||
      charge.paid !== true || charge.captured !== true || charge.status !== "succeeded" ||
      charge.refunded !== false || charge.amount_refunded !== 0 || charge.disputed !== false) {
    throw new Error("Cart payment is not confirmed, captured and unrefunded");
  }
  return current;
}
