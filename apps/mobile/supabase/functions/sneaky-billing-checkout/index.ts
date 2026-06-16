/**
 * Sneaky Lynk Billing Checkout — Stripe Billing subscription
 *
 * POST /sneaky-billing-checkout
 * Body: { plan_id, user_id }
 * plan_id: "host_25" | "host_50"
 *
 * Returns: { url, session_id } — Stripe Checkout Session (subscription mode)
 *
 * Stripe API: 2026-02-25.clover
 * Webhook source of truth: customer.subscription.created / updated / deleted
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_SCHEME = "dvnt";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[sneaky-billing-checkout] FATAL: STRIPE_SECRET_KEY env var is not set. Configure via: npx supabase secrets set STRIPE_SECRET_KEY=sk_...",
  );
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
  // Always return HTTP 200 — supabase.functions.invoke() routes non-2xx to `error`
  // instead of `data`, losing error messages. Use { ok: false, error } for errors.
  const httpStatus = status >= 200 && status < 300 ? status : 200;
  return new Response(JSON.stringify(data), {
    status: httpStatus,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function stripePost(
  endpoint: string,
  body: Record<string, string>,
): Promise<any> {
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

async function stripeGet(endpoint: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Stripe-Version": "2026-02-25.clover",
    },
  });
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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

    // ── Session auth (mandatory) ──────────────────────────
    const user_id = await verifySession(supabase, req);
    if (!user_id) {
      return json({ error: "Unauthorized — invalid or expired session" }, 401);
    }

    const { plan_id } = await req.json();

    if (!plan_id) {
      return json({ error: "Missing plan_id" }, 400);
    }

    if (!["host_25", "host_50"].includes(plan_id)) {
      return json(
        { error: "Invalid plan_id. Must be host_25 or host_50" },
        400,
      );
    }

    // ── Fetch plan details ───────────────────────────────────
    const { data: plan, error: planError } = await supabase
      .from("sneaky_subscription_plans")
      .select("*")
      .eq("id", plan_id)
      .single();

    if (planError || !plan) {
      return json({ error: "Plan not found" }, 404);
    }

    // ── Check for existing active subscription ──────────────
    const { data: existingSub } = await supabase
      .from("sneaky_subscriptions")
      .select("status, plan_id, stripe_subscription_id")
      .eq("host_id", user_id)
      .single();

    if (existingSub?.status === "active" && existingSub.plan_id === plan_id) {
      return json(
        {
          error: "Already subscribed to this plan. Manage via billing portal.",
        },
        409,
      );
    }

    // ── Get or create Stripe Customer ────────────────────────
    let stripeCustomerId: string;
    const { data: existingCustomer } = await supabase
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user_id)
      .single();

    if (existingCustomer?.stripe_customer_id) {
      stripeCustomerId = existingCustomer.stripe_customer_id;
    } else {
      const customer = await stripePost("/customers", {
        "metadata[dvnt_user_id]": user_id,
      });
      stripeCustomerId = customer.id;
      await supabase.from("stripe_customers").upsert({
        user_id,
        stripe_customer_id: stripeCustomerId,
      });
    }

    // ── Ensure Stripe product + price exist for this plan ───
    // Use plan.stripe_price_id if already seeded; otherwise create on-demand.
    let stripePriceId = plan.stripe_price_id;

    if (!stripePriceId) {
      // Re-read plan to avoid race with concurrent request that may have just created IDs
      const { data: freshPlan } = await supabase
        .from("sneaky_subscription_plans")
        .select("stripe_product_id, stripe_price_id")
        .eq("id", plan_id)
        .single();

      if (freshPlan?.stripe_price_id) {
        stripePriceId = freshPlan.stripe_price_id;
      } else {
        // Create product if needed
        let stripeProductId =
          freshPlan?.stripe_product_id || plan.stripe_product_id;
        if (!stripeProductId) {
          const product = await stripePost("/products", {
            name: `Sneaky Lynk ${plan.name}`,
            "metadata[plan_id]": plan_id,
          });
          stripeProductId = product.id;
        }

        // Create price
        const price = await stripePost("/prices", {
          product: stripeProductId,
          unit_amount: plan.price_cents.toString(),
          currency: "usd",
          "recurring[interval]": plan.interval,
          "metadata[plan_id]": plan_id,
        });
        stripePriceId = price.id;

        // Persist Stripe IDs back to the plan row for reuse
        await supabase
          .from("sneaky_subscription_plans")
          .update({
            stripe_product_id: stripeProductId,
            stripe_price_id: stripePriceId,
          })
          .eq("id", plan_id)
          .is("stripe_price_id", null); // Only write if still null (CAS)
      }
    }

    // ── Existing paid subscription: update the Stripe price directly ──
    // This keeps Stripe as the source of truth for the next invoice amount.
    // Upgrades invoice prorated difference immediately. Downgrades create a
    // prorated credit and set the lower recurring price for the next invoice.
    if (
      existingSub?.stripe_subscription_id &&
      ["active", "trialing"].includes(existingSub.status) &&
      existingSub.plan_id !== plan_id
    ) {
      if (!stripePriceId) {
        throw new Error("Stripe price is not configured for this plan");
      }

      const stripeSub = await stripeGet(
        `/subscriptions/${existingSub.stripe_subscription_id}`,
      );
      if (stripeSub.error) {
        throw new Error(stripeSub.error.message || "Subscription not found");
      }

      const subscriptionItemId = stripeSub.items?.data?.[0]?.id;
      if (!subscriptionItemId) {
        throw new Error("Subscription item not found");
      }

      const { data: currentPlan } = await supabase
        .from("sneaky_subscription_plans")
        .select("price_cents")
        .eq("id", existingSub.plan_id)
        .single();

      const currentPriceCents = Number(currentPlan?.price_cents ?? 0);
      const targetPriceCents = Number(plan.price_cents ?? 0);
      const isUpgrade = targetPriceCents > currentPriceCents;
      const prorationBehavior = isUpgrade
        ? "always_invoice"
        : "create_prorations";

      const updatedSub = await stripePost(
        `/subscriptions/${existingSub.stripe_subscription_id}`,
        {
          "items[0][id]": subscriptionItemId,
          "items[0][price]": stripePriceId,
          "items[0][quantity]": "1",
          proration_behavior: prorationBehavior,
          payment_behavior: "allow_incomplete",
          cancel_at_period_end: "false",
          "metadata[dvnt_user_id]": user_id,
          "metadata[plan_id]": plan_id,
        },
      );

      const stripePrice =
        updatedSub.items?.data?.[0]?.price?.id || stripePriceId;
      await supabase
        .from("sneaky_subscriptions")
        .update({
          plan_id,
          status: updatedSub.status,
          stripe_price_id: stripePrice,
          current_period_start: updatedSub.current_period_start
            ? new Date(updatedSub.current_period_start * 1000).toISOString()
            : null,
          current_period_end: updatedSub.current_period_end
            ? new Date(updatedSub.current_period_end * 1000).toISOString()
            : null,
          cancel_at_period_end: updatedSub.cancel_at_period_end || false,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", existingSub.stripe_subscription_id);

      return json({
        updated: true,
        subscription_id: updatedSub.id,
        plan_id,
        status: updatedSub.status,
        proration_behavior: prorationBehavior,
        billing_effect: isUpgrade
          ? "upgrade_prorated_now"
          : "downgrade_credit_next_invoice",
      });
    }

    // ── Create Stripe Checkout Session (subscription mode) ──
    const session = await stripePost("/checkout/sessions", {
      mode: "subscription",
      "payment_method_types[0]": "card",
      customer: stripeCustomerId,
      "line_items[0][price]": stripePriceId,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][dvnt_user_id]": user_id,
      "subscription_data[metadata][plan_id]": plan_id,
      "metadata[type]": "sneaky_subscription",
      "metadata[user_id]": user_id,
      "metadata[plan_id]": plan_id,
      // Allow Stripe to collect + save billing address (required for automatic_tax)
      "customer_update[address]": "auto",
      // Stripe Tax: automatic collection
      "automatic_tax[enabled]": "true",
      success_url: `${APP_SCHEME}://sneaky/billing/success?plan=${plan_id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_SCHEME}://sneaky/billing/cancel`,
    });

    // ── Create pending order row ─────────────────────────────
    await supabase.from("orders").insert({
      user_id,
      type: "sneaky_subscription",
      status: "payment_pending",
      subtotal_cents: plan.price_cents,
      total_cents: plan.price_cents,
      fee_policy_version: "none",
      stripe_checkout_session_id: session.id,
    });

    return json({ url: session.url, session_id: session.id });
  } catch (err: any) {
    console.error("[sneaky-billing-checkout] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
