/**
 * DVNT Membership / Sneaky Lynk checkout + plan switch (web, reader-app pattern).
 *
 * POST /membership-checkout
 * Body: { plan_key }   // dvnt_core | dvnt_insider | dvnt_vip | dvnt_founders_circle | sneaky_tier_1 | sneaky_tier_2
 *
 * Behavior:
 *  - No active subscription → create a Stripe Checkout Session (subscription
 *    mode) and return { url }.
 *  - Active subscription exists → SWITCH the existing Stripe subscription's item
 *    to the new price with proration (no duplicate subscription); a DVNT
 *    Membership supersedes a standalone Sneaky Lynk subscription. Return
 *    { ok: true, switched: true }. The stripe-webhook syncs DB state.
 *
 * Plan → Stripe price id is resolved from env (STRIPE_PRICE_DVNT_VIP, …), with a
 * one-time create-on-demand fallback persisted into membership_plans.stripe_price_id.
 * Webhook is the source of truth for subscription state.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("DVNT_WEB_URL") || "http://localhost:3000";

// plan_key → env var holding its Stripe price id (mirrors lib/subscription/plans.ts).
const PRICE_ENV: Record<string, string> = {
  sneaky_tier_1: "STRIPE_PRICE_SNEAKY_TIER_1",
  sneaky_tier_2: "STRIPE_PRICE_SNEAKY_TIER_2",
  dvnt_core: "STRIPE_PRICE_DVNT_CORE",
  dvnt_insider: "STRIPE_PRICE_DVNT_INSIDER",
  dvnt_vip: "STRIPE_PRICE_DVNT_VIP",
  dvnt_founders_circle: "STRIPE_PRICE_DVNT_FOUNDERS",
};
const FAMILY: Record<string, "sneaky_lynk" | "dvnt_membership"> = {
  sneaky_tier_1: "sneaky_lynk",
  sneaky_tier_2: "sneaky_lynk",
  dvnt_core: "dvnt_membership",
  dvnt_insider: "dvnt_membership",
  dvnt_vip: "dvnt_membership",
  dvnt_founders_circle: "dvnt_membership",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
  const httpStatus = status >= 200 && status < 300 ? status : 200;
  return new Response(JSON.stringify(data), {
    status: httpStatus,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function stripePost(endpoint: string, body: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2026-02-25.clover",
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function stripeGet(endpoint: string) {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Stripe-Version": "2026-02-25.clover",
    },
  });
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!STRIPE_SECRET_KEY) {
    return json({ ok: false, error: "Stripe is not configured for this environment." }, 503);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const user_id = await verifySession(supabase, req);
    if (!user_id) return json({ ok: false, error: "Unauthorized — invalid or expired session" }, 401);

    const { plan_key } = await req.json();
    if (!plan_key || !PRICE_ENV[plan_key]) {
      return json({ ok: false, error: "Invalid or missing plan_key" }, 400);
    }
    const family = FAMILY[plan_key];

    // ── Resolve the Stripe price id (env first, then on-demand create) ──
    let priceId = Deno.env.get(PRICE_ENV[plan_key]) || "";
    if (!priceId) {
      const { data: planRow } = await supabase
        .from("membership_plans")
        .select("name, price_cents, stripe_price_id")
        .eq("plan_key", plan_key)
        .single();
      if (planRow?.stripe_price_id) {
        priceId = planRow.stripe_price_id as string;
      } else if (planRow) {
        const product = await stripePost("/products", {
          name: `DVNT ${planRow.name}`,
          "metadata[plan_key]": plan_key,
        });
        const price = await stripePost("/prices", {
          product: product.id,
          unit_amount: String(planRow.price_cents),
          currency: "usd",
          "recurring[interval]": "month",
          "metadata[plan_key]": plan_key,
        });
        priceId = price.id;
        await supabase
          .from("membership_plans")
          .update({ stripe_price_id: priceId })
          .eq("plan_key", plan_key);
      }
    }
    if (!priceId) return json({ ok: false, error: "Plan price not configured" }, 500);

    // ── Get or create the Stripe customer ──
    let stripeCustomerId: string;
    const { data: existingCustomer } = await supabase
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user_id)
      .single();
    if (existingCustomer?.stripe_customer_id) {
      stripeCustomerId = existingCustomer.stripe_customer_id;
    } else {
      const customer = await stripePost("/customers", { "metadata[dvnt_user_id]": user_id });
      stripeCustomerId = customer.id;
      await supabase.from("stripe_customers").upsert({ user_id, stripe_customer_id: stripeCustomerId });
    }

    // ── Find an existing active subscription to switch (membership first, then sneaky-only) ──
    const { data: membershipSub } = await supabase
      .from("membership_subscriptions")
      .select("stripe_subscription_id, plan_key, status")
      .eq("user_id", user_id)
      .maybeSingle();
    const { data: sneakySub } = await supabase
      .from("sneaky_subscriptions")
      .select("stripe_subscription_id, plan_id, status")
      .eq("host_id", user_id)
      .maybeSingle();

    const activeMembership =
      membershipSub && ["active", "trialing", "past_due"].includes(membershipSub.status)
        ? membershipSub
        : null;
    const activeSneaky =
      sneakySub && ["active", "trialing", "past_due"].includes(sneakySub.status)
        ? sneakySub
        : null;
    const switchTarget = activeMembership ?? activeSneaky;

    if (switchTarget?.stripe_subscription_id) {
      if (activeMembership && activeMembership.plan_key === plan_key) {
        return json({ ok: false, error: "You're already on this plan." }, 409);
      }
      // SWITCH the existing subscription's single item to the new price, prorating.
      const sub = await stripeGet(`/subscriptions/${switchTarget.stripe_subscription_id}`);
      const itemId = sub?.items?.data?.[0]?.id;
      if (!itemId) throw new Error("Existing subscription has no item to switch");
      await stripePost(`/subscriptions/${switchTarget.stripe_subscription_id}`, {
        "items[0][id]": itemId,
        "items[0][price]": priceId,
        proration_behavior: "create_prorations",
        payment_behavior: "error_if_incomplete",
        "metadata[plan_key]": plan_key,
        "metadata[product_family]": family,
        "metadata[dvnt_user_id]": user_id,
      });

      // If a DVNT membership supersedes a standalone Sneaky sub, the same Stripe
      // subscription now carries the membership; record the switch. (The webhook
      // reconciles membership_subscriptions; we mark the sneaky row superseded.)
      if (family === "dvnt_membership" && activeSneaky && !activeMembership) {
        await supabase
          .from("sneaky_subscriptions")
          .update({ status: "canceled", canceled_at: new Date().toISOString() })
          .eq("host_id", user_id);
      }
      await supabase.from("membership_subscription_events").insert({
        user_id,
        stripe_subscription_id: switchTarget.stripe_subscription_id,
        kind: "switch",
        to_plan_key: plan_key,
      });
      return json({ ok: true, switched: true });
    }

    // ── No active subscription → create a Checkout Session ──
    const session = await stripePost("/checkout/sessions", {
      mode: "subscription",
      customer: stripeCustomerId,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${SITE_URL}/pricing?checkout=success`,
      cancel_url: `${SITE_URL}/pricing?checkout=cancelled`,
      "subscription_data[metadata][plan_key]": plan_key,
      "subscription_data[metadata][product_family]": family,
      "subscription_data[metadata][dvnt_user_id]": user_id,
      "metadata[dvnt_user_id]": user_id,
      allow_promotion_codes: "true",
    });

    return json({ ok: true, url: session.url });
  } catch (e) {
    console.error("[membership-checkout]", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
