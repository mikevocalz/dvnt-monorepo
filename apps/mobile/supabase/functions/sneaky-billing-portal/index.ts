/**
 * Sneaky Lynk Billing Portal — Stripe Customer Portal link
 *
 * POST /sneaky-billing-portal
 * Body: { user_id }
 *
 * Returns: { url } — Stripe Billing Portal session URL
 * User can manage/cancel subscription, update payment method.
 *
 * Stripe API: 2026-02-25.clover
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_SCHEME = "dvnt";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[sneaky-billing-portal] FATAL: STRIPE_SECRET_KEY env var is not set.",
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

    // Look up Stripe customer ID
    const { data: customer } = await supabase
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user_id)
      .single();

    if (!customer?.stripe_customer_id) {
      return json({ error: "No billing account found. Subscribe first." }, 404);
    }

    // Create Stripe Billing Portal session
    const res = await fetch(
      "https://api.stripe.com/v1/billing_portal/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": "2026-02-25.clover",
        },
        body: new URLSearchParams({
          customer: customer.stripe_customer_id,
          return_url: `${APP_SCHEME}://sneaky/billing`,
        }).toString(),
      },
    );

    const session = await res.json();
    if (session.error) throw new Error(session.error.message);

    return json({ url: session.url });
  } catch (err: any) {
    console.error("[sneaky-billing-portal] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
