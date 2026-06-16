/**
 * Sneaky Access Checkout Edge Function
 *
 * POST /sneaky-access-checkout  { session_id, user_id }
 *
 * Creates Stripe Checkout for $2.99 sneaky link access.
 * Ticket issuance happens via webhook (never trust client).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_SCHEME = "dvnt";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[sneaky-access-checkout] FATAL: STRIPE_SECRET_KEY env var is not set. Configure via: npx supabase secrets set STRIPE_SECRET_KEY=sk_...",
  );
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
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!STRIPE_SECRET_KEY) {
    return new Response(
      JSON.stringify({
        error: "Stripe is not configured for this environment. Contact support.",
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
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
      return new Response(
        JSON.stringify({ error: "Unauthorized — invalid or expired session" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const { session_id } = await req.json();

    if (!session_id) {
      return new Response(JSON.stringify({ error: "Missing session_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if user already has access
    const { data: existing } = await supabase
      .from("sneaky_access")
      .select("session_id")
      .eq("session_id", session_id)
      .eq("user_id", user_id)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ already_paid: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if room is the host (host never pays)
    const { data: room } = await supabase
      .from("video_rooms")
      .select("host_id")
      .eq("id", session_id)
      .single();

    if (room?.host_id === user_id) {
      return new Response(JSON.stringify({ host: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create Stripe Checkout Session
    const params: Record<string, string> = {
      mode: "payment",
      "payment_method_types[0]": "card",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "299",
      "line_items[0][price_data][product_data][name]": "Sneaky Lynk Access",
      "line_items[0][quantity]": "1",
      "metadata[type]": "sneaky_access",
      "metadata[session_id]": session_id,
      "metadata[user_id]": user_id,
      // Stripe Tax: automatic collection
      "automatic_tax[enabled]": "true",
      success_url: `${APP_SCHEME}://sneaky/success?sessionId=${session_id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_SCHEME}://sneaky/cancel?sessionId=${session_id}`,
    };

    const session = await stripeRequest("/checkout/sessions", params);

    if (session.error) {
      throw new Error(session.error.message);
    }

    return new Response(
      JSON.stringify({ url: session.url, session_id: session.id }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[sneaky-access-checkout] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
