/**
 * Promotion Webhook Edge Function
 *
 * POST /promotion-webhook
 * Handles Stripe webhook events for promotion payments.
 *
 * On checkout.session.completed with metadata.type === "promotion":
 *   - Activates the campaign row idempotently
 *   - Updates stripe_payment_intent_id
 *
 * Idempotent: re-processing the same event is safe.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_WEBHOOK_SECRET =
  Deno.env.get("STRIPE_PROMOTION_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const IS_LOCAL_DEV =
  Deno.env.get("SUPABASE_URL")?.includes("localhost") ||
  Deno.env.get("SUPABASE_URL")?.includes("127.0.0.1") ||
  false;

async function verifyStripeSignature(
  body: string,
  signature: string,
): Promise<any> {
  // Stripe webhook signature verification using Web Crypto API
  const encoder = new TextEncoder();
  const parts = signature.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.split("=")[1];
  const v1Sig = parts.find((p) => p.startsWith("v1="))?.split("=")[1];

  if (!timestamp || !v1Sig) throw new Error("Invalid signature format");

  const signedPayload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedPayload),
  );
  const expectedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedSig !== v1Sig) throw new Error("Signature mismatch");

  // Verify timestamp is within 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (Math.abs(age) > 300) throw new Error("Timestamp too old");

  return JSON.parse(body);
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.text();
    const signature = req.headers.get("Stripe-Signature") || "";

    let event: any;
    if (STRIPE_WEBHOOK_SECRET) {
      event = await verifyStripeSignature(body, signature);
    } else if (IS_LOCAL_DEV) {
      // Local dev only — skip signature verification
      console.warn(
        "[promotion-webhook] LOCAL DEV: skipping signature verification",
      );
      event = JSON.parse(body);
    } else {
      // FAIL-CLOSED: production without webhook secret is a misconfiguration
      console.error(
        "[promotion-webhook] STRIPE_PROMOTION_WEBHOOK_SECRET is not set — rejecting request",
      );
      return new Response(
        JSON.stringify({ error: "Webhook secret not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Two activation paths:
    //  - checkout.session.completed   → legacy browser Stripe Checkout
    //  - payment_intent.succeeded     → native PaymentSheet (in-app)
    // Both carry the same metadata.campaign_id we set when creating
    // the PaymentIntent / Session.
    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "payment_intent.succeeded"
    ) {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Idempotency: dedup via stripe_events table ────────
    const supabaseEarly = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const { error: dedupError } = await supabaseEarly
      .from("stripe_events")
      .insert({ event_id: event.id, event_type: event.type });

    if (dedupError) {
      // Unique constraint violation — already processed
      console.log(`[promotion-webhook] Duplicate event ${event.id}, skipping`);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const obj = event.data.object;
    const metadata = obj.metadata || {};

    if (metadata.type !== "promotion") {
      return new Response(JSON.stringify({ received: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const campaignId = parseInt(metadata.campaign_id);
    // For a Checkout Session the PI is `obj.payment_intent`. For a
    // PaymentIntent event the object itself IS the PI, so we use `obj.id`.
    const paymentIntent =
      event.type === "payment_intent.succeeded" ? obj.id : obj.payment_intent;

    if (!campaignId) {
      console.error("[promotion-webhook] Missing campaign_id in metadata");
      return new Response(JSON.stringify({ error: "Missing campaign_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    // Idempotent activation: only update if still pending
    const { data: campaign, error: fetchError } = await supabase
      .from("event_spotlight_campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .single();

    if (fetchError || !campaign) {
      console.error("[promotion-webhook] Campaign not found:", campaignId);
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already activated — idempotent
    if (campaign.status === "active") {
      console.log("[promotion-webhook] Campaign already active:", campaignId);
      return new Response(
        JSON.stringify({ received: true, already_active: true }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Activate the campaign
    const { error: updateError } = await supabase
      .from("event_spotlight_campaigns")
      .update({
        status: "active",
        stripe_payment_intent_id: paymentIntent,
      })
      .eq("id", campaignId)
      .eq("status", "pending"); // Only activate if still pending (CAS)

    if (updateError) {
      console.error("[promotion-webhook] Activation error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to activate campaign" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("[promotion-webhook] Campaign activated:", campaignId);

    return new Response(
      JSON.stringify({
        received: true,
        campaign_id: campaignId,
        activated: true,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("[promotion-webhook] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
