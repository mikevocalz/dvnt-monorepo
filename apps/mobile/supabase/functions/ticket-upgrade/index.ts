/**
 * Ticket Upgrade Edge Function (native PaymentSheet)
 *
 * POST /ticket-upgrade
 * Body: { ticket_id, new_ticket_type_id }
 *
 * Returns: { paymentIntent, ephemeralKey, customer, publishableKey, paymentIntentId, diff_cents, buyer_fee }
 *
 * Creates a Stripe PaymentIntent charging the price DIFFERENCE between
 * the user's current ticket and the requested higher tier, plus a buyer
 * service fee. The client opens the native PaymentSheet with this PI.
 *
 * On payment_intent.succeeded, stripe-webhook (case metadata.type ===
 * "ticket_upgrade" inside payment_intent.succeeded) updates the existing
 * ticket row to the new tier.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { computeFees } from "../_shared/fee-calculator.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_PUBLISHABLE_KEY = Deno.env.get("STRIPE_PUBLISHABLE_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[ticket-upgrade] FATAL: STRIPE_SECRET_KEY env var is not set. Configure via: npx supabase secrets set STRIPE_SECRET_KEY=sk_...",
  );
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function stripeRequest(
  endpoint: string,
  body: Record<string, string>,
): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function getOrCreateCustomer(
  supabase: any,
  authId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", authId)
    .single();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const { data: authUser } = await supabase
    .from("user")
    .select("id, name, email")
    .eq("id", authId)
    .single();

  const params: Record<string, string> = {
    "metadata[dvnt_user_id]": authId,
  };
  if (authUser?.email) params.email = authUser.email;
  if (authUser?.name) params.name = authUser.name;

  const customer = await stripeRequest("/customers", params);

  await supabase.from("stripe_customers").upsert({
    user_id: authId,
    stripe_customer_id: customer.id,
  });

  return customer.id;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  if (!STRIPE_SECRET_KEY) {
    return json(
      {
        error:
          "Stripe is not configured for this environment. Contact support.",
      },
      503,
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { ticket_id, new_ticket_type_id } = await req.json();
    if (!ticket_id || !new_ticket_type_id) {
      return json(
        { error: "ticket_id and new_ticket_type_id are required" },
        400,
      );
    }

    // Fetch the existing ticket
    const { data: ticket, error: ticketErr } = await supabase
      .from("tickets")
      .select("id, event_id, user_id, ticket_type_id, purchase_amount_cents, status")
      .eq("id", ticket_id)
      .single();

    if (ticketErr || !ticket) {
      return json({ error: "Ticket not found" }, 404);
    }

    if (ticket.user_id !== authId) {
      return json({ error: "You don't own this ticket" }, 403);
    }

    if (ticket.status !== "active" && ticket.status !== "valid") {
      return json({ error: "Ticket is not active" }, 400);
    }

    if (String(ticket.ticket_type_id) === String(new_ticket_type_id)) {
      return json({ error: "You already have this tier" }, 400);
    }

    // Fetch the new tier
    const { data: newType, error: newTypeErr } = await supabase
      .from("ticket_types")
      .select("*")
      .eq("id", new_ticket_type_id)
      .eq("event_id", ticket.event_id)
      .single();

    if (newTypeErr || !newType) {
      return json({ error: "New tier not found for this event" }, 404);
    }

    if (newType.is_active === false) {
      return json({ error: "This tier is not available" }, 400);
    }

    // Check availability for the new tier
    const totalCap = newType.quantity_total ?? Infinity;
    const sold = newType.quantity_sold ?? 0;
    const availableSlots = totalCap - sold;
    if (availableSlots <= 0) {
      return json({ error: "This tier is sold out" }, 400);
    }

    const paidCents = ticket.purchase_amount_cents || 0;
    const newPriceCents = newType.price_cents || 0;
    const diffCents = Math.max(0, newPriceCents - paidCents);

    if (diffCents === 0) {
      return json(
        { error: "New tier must cost more than your current tier" },
        400,
      );
    }

    if (newPriceCents < paidCents) {
      return json({ error: "Downgrades are not supported" }, 400);
    }

    // Compute buyer fees: 2.5% + $1 on top of the price difference
    const fees = computeFees(diffCents, 1);

    // Stripe Customer + ephemeral key for PaymentSheet
    const customerId = await getOrCreateCustomer(supabase, authId);

    const pi = await stripeRequest("/payment_intents", {
      amount: String(fees.customer_charge_amount),
      currency: "usd",
      customer: customerId,
      "automatic_payment_methods[enabled]": "true",
      description: `Upgrade to ${newType.name}`,
      "metadata[type]": "ticket_upgrade",
      "metadata[ticket_id]": String(ticket_id),
      "metadata[new_ticket_type_id]": String(new_ticket_type_id),
      "metadata[old_ticket_type_id]": String(ticket.ticket_type_id),
      "metadata[event_id]": String(ticket.event_id),
      "metadata[user_auth_id]": authId,
      "metadata[diff_cents]": String(diffCents),
      "metadata[buyer_fee_cents]": String(fees.buyer_fee),
      "metadata[fee_policy_version]": fees.fee_policy_version,
    });

    const ephemeralRes = await fetch(
      "https://api.stripe.com/v1/ephemeral_keys",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": "2026-02-25.clover",
        },
        body: new URLSearchParams({ customer: customerId }).toString(),
      },
    );
    const ephemeralKey = await ephemeralRes.json();

    return json({
      paymentIntent: pi.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customerId,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      paymentIntentId: pi.id,
      diff_cents: diffCents,
      buyer_fee: fees.buyer_fee,
      customer_charge_amount: fees.customer_charge_amount,
    });
  } catch (err: any) {
    console.error("[ticket-upgrade]", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
