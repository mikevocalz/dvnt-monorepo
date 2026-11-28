/** Fetch current captured hosted-payment evidence before updating final tax.
 * This is preparation for the existing atomic issuer, never paid/fulfillment
 * evidence and never a source enrollment or provider mutation.
 */
export async function prepareSettlementHostedIssuance(
  db: any, orderId: string, sessionId: string,
): Promise<any> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Error("Invalid hosted checkout reference");
  const get = async (path: string) => {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: {
        Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY") || ""}`,
        "Stripe-Version": "2026-09-30.endive",
      },
      signal: AbortSignal.timeout(30000),
    });
    const value = await response.json();
    if (!response.ok || value?.error) throw new Error("Captured hosted payment could not be verified");
    return value;
  };
  const session = await get(`checkout/sessions/${encodeURIComponent(sessionId)}`);
  const piId = typeof session?.payment_intent === "string" ? session.payment_intent : session?.payment_intent?.id;
  if (session?.id !== sessionId || !/^pi_[A-Za-z0-9_]+$/.test(piId || "")) {
    throw new Error("Hosted checkout payment reference mismatch");
  }
  const intent = await get(`payment_intents/${encodeURIComponent(piId)}`);
  const chargeId = typeof intent?.latest_charge === "string" ? intent.latest_charge : intent?.latest_charge?.id;
  if (intent?.id !== piId || !/^ch_[A-Za-z0-9_]+$/.test(chargeId || "")) {
    throw new Error("Hosted checkout charge reference mismatch");
  }
  const charge = await get(`charges/${encodeURIComponent(chargeId)}`);
  const {data, error} = await db.rpc("prepare_settlement_hosted_issuance", {
    p_order_id: orderId,
    p_session: {...session, payment_intent: piId},
    p_intent: {...intent, latest_charge: chargeId},
    p_charge: {...charge, payment_intent: typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id},
  });
  if (error) throw error;
  if (data?.ok !== true || data.order_id !== orderId || data.amount_cents !== session.amount_total) {
    throw new Error("Captured hosted payment preparation was rejected");
  }
  return {...session, payment_intent: piId};
}
