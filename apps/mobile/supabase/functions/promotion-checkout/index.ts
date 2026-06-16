/**
 * Promotion Checkout Edge Function
 *
 * POST /promotion-checkout
 * Body: { event_id, city_id, duration, placement, start_now, organizer_id }
 *
 * Creates a Stripe Checkout Session for event promotion purchase.
 * Payment goes to DVNT (platform revenue), NOT the organizer.
 *
 * On success webhook: creates/activates campaign row idempotently.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession as sharedVerifySession } from "../_shared/verify-session.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_PUBLISHABLE_KEY = Deno.env.get("STRIPE_PUBLISHABLE_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_SCHEME = "dvnt";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[promotion-checkout] FATAL: STRIPE_SECRET_KEY env var is not set.",
  );
}

// Pricing in cents
const PRICING: Record<string, number> = {
  "24h": 999,
  "7d": 3999,
  weekend: 1999,
};

// Duration → hours mapping
const DURATION_HOURS: Record<string, number> = {
  "24h": 24,
  "7d": 168,
  weekend: 72, // Fri 6pm → Mon 6am approx
};

function computeEndDate(startDate: Date, duration: string): Date {
  if (duration === "weekend") {
    // Find next Sunday 23:59 from start
    const end = new Date(startDate);
    const day = end.getDay();
    // If it's before Friday, jump to coming Sunday
    const daysUntilSunday = (7 - day) % 7 || 7;
    end.setDate(end.getDate() + daysUntilSunday);
    end.setHours(23, 59, 59, 999);
    return end;
  }
  const hours = DURATION_HOURS[duration] || 24;
  return new Date(startDate.getTime() + hours * 60 * 60 * 1000);
}

async function stripeRequest(
  endpoint: string,
  body: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...extraHeaders,
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

/**
 * Get or create a Stripe Customer for a DVNT user.
 * Mirrors the create-payment-intent implementation so the same
 * stripe_customers row is reused across ticket + promotion checkouts.
 */
async function getOrCreateCustomer(
  supabase: any,
  userId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .single();

  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const { data: authUser } = await supabase
    .from("user")
    .select("id, name, email")
    .eq("id", userId)
    .single();

  const params: Record<string, string> = {
    "metadata[dvnt_user_id]": userId,
  };
  if (authUser?.email) params.email = authUser.email;
  if (authUser?.name) params.name = authUser.name;

  const customer = await stripeRequest("/customers", params);

  await supabase.from("stripe_customers").upsert({
    user_id: userId,
    stripe_customer_id: customer.id,
  });

  return customer.id;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

  if (!STRIPE_SECRET_KEY) {
    return new Response(
      JSON.stringify({
        error: "Stripe is not configured for this environment.",
      }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const {
      event_id,
      city_id,
      duration,
      placement = "spotlight+feed",
      start_now = true,
      organizer_id,
      // "payment_sheet" → return PaymentIntent client_secret + ephemeralKey
      // for the in-app native Stripe PaymentSheet (default for new clients).
      // "checkout_session" → return a Stripe Checkout Session URL for the
      // older browser-redirect flow (kept for backward compat).
      mode = "payment_sheet",
    } = await req.json();

    if (!event_id || !duration || !organizer_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const priceCents = PRICING[duration];
    if (!priceCents) {
      return new Response(JSON.stringify({ error: "Invalid duration" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    // Verify session — MANDATORY, no fallback (Option A)
    const userId = await sharedVerifySession(supabase, req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — invalid or expired session" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (userId !== organizer_id) {
      return new Response(
        JSON.stringify({
          error: "Forbidden — session does not match organizer_id",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check for existing active/pending campaign for this event
    const { data: existingCampaign } = await supabase
      .from("event_spotlight_campaigns")
      .select("id, status")
      .eq("event_id", parseInt(event_id))
      .in("status", ["active", "pending"])
      .limit(1)
      .single();

    if (existingCampaign) {
      return new Response(
        JSON.stringify({
          error: `This event already has an ${existingCampaign.status} promotion campaign`,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Verify event ownership
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, title, host_id")
      .eq("id", event_id)
      .single();

    if (eventError || !event) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event.host_id !== organizer_id) {
      return new Response(
        JSON.stringify({ error: "Not authorized to promote this event" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Compute time window
    const startsAt = start_now ? new Date() : new Date(); // TODO: scheduled start
    const endsAt = computeEndDate(startsAt, duration);

    // Create pending campaign row
    const { data: campaign, error: campaignError } = await supabase
      .from("event_spotlight_campaigns")
      .insert({
        event_id: parseInt(event_id),
        city_id: city_id ? parseInt(city_id) : null,
        organizer_id,
        placement,
        status: "pending",
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        amount_cents: priceCents,
        currency: "usd",
      })
      .select("id")
      .single();

    if (campaignError) {
      console.error(
        "[promotion-checkout] Campaign insert error:",
        campaignError,
      );
      return new Response(
        JSON.stringify({ error: "Failed to create campaign" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const durationLabel =
      duration === "24h"
        ? "24 Hours"
        : duration === "7d"
          ? "7 Days"
          : "Weekend";

    if (mode === "payment_sheet") {
      // ── Native PaymentSheet flow (same UX as ticket purchase) ──
      // Use a Stripe Customer + ephemeral key so the sheet can show
      // saved cards and Apple/Google Pay when the merchant cert is set.
      const customerId = await getOrCreateCustomer(supabase, organizer_id);

      const idempotencyKey = `promo_${campaign.id}_${Date.now()}`;
      const pi = await stripeRequest(
        "/payment_intents",
        {
          amount: String(priceCents),
          currency: "usd",
          customer: customerId,
          "automatic_payment_methods[enabled]": "true",
          description: `Event Spotlight: ${event.title} (${durationLabel} · ${placement})`,
          "metadata[campaign_id]": String(campaign.id),
          "metadata[event_id]": String(event_id),
          "metadata[organizer_id]": organizer_id,
          "metadata[type]": "promotion",
          "metadata[duration]": String(duration),
          "metadata[placement]": String(placement),
        },
        { "Idempotency-Key": idempotencyKey },
      );

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
      if (ephemeralKey?.error) {
        throw new Error(
          ephemeralKey.error.message || "Failed to mint ephemeral key",
        );
      }

      // Persist the PI on the pending campaign so the webhook can match it.
      await supabase
        .from("event_spotlight_campaigns")
        .update({ stripe_payment_intent_id: pi.id })
        .eq("id", campaign.id);

      return new Response(
        JSON.stringify({
          campaign_id: campaign.id,
          paymentIntent: pi.client_secret,
          paymentIntentId: pi.id,
          ephemeralKey: ephemeralKey.secret,
          customer: customerId,
          publishableKey: STRIPE_PUBLISHABLE_KEY,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── Legacy Stripe Checkout Session flow (browser redirect) ──
    // Kept so old clients on stale OTAs don't break the moment we ship.
    const session = await stripeRequest("/checkout/sessions", {
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(priceCents),
      "line_items[0][price_data][product_data][name]": `Event Spotlight: ${event.title}`,
      "line_items[0][price_data][product_data][description]": `${durationLabel} promotion — ${placement}`,
      "line_items[0][quantity]": "1",
      "metadata[campaign_id]": String(campaign.id),
      "metadata[event_id]": String(event_id),
      "metadata[organizer_id]": organizer_id,
      "metadata[type]": "promotion",
      // Stripe Tax: automatic collection
      "automatic_tax[enabled]": "true",
      success_url: `${APP_SCHEME}://events/${event_id}?promoted=true`,
      cancel_url: `${APP_SCHEME}://events/${event_id}?promoted=cancelled`,
    });

    await supabase
      .from("event_spotlight_campaigns")
      .update({ stripe_payment_intent_id: session.payment_intent })
      .eq("id", campaign.id);

    return new Response(
      JSON.stringify({
        url: session.url,
        campaign_id: campaign.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("[promotion-checkout] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
