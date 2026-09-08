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
  // Unused for `weekend` — that package ends at the close of the coming
  // Sunday in the event's timezone, not after a fixed span. Kept as the
  // fallback for an unrecognised duration.
  weekend: 72,
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Wall-clock parts of an instant as seen in `timeZone`. */
function zonedParts(instant: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

/** Zone offset from UTC at `instant`, whole minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Rounded: `asUtc` is second-precision and `instant` carries milliseconds.
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The instant at which a wall-clock time occurs in `timeZone`. */
function instantFromZoned(
  wall: { year: number; month: number; day: number; hour: number; minute: number; second: number; ms?: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(
    wall.year, wall.month - 1, wall.day,
    wall.hour, wall.minute, wall.second, wall.ms ?? 0,
  );
  // Resolved twice: the offset depends on the instant, so across a DST
  // boundary the first guess uses the wrong one.
  let guess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - offsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/**
 * When a boost ends, in the EVENT'S timezone.
 *
 * This used `getDay()` / `setDate()` / `setHours()` — local-time methods, in a
 * Deno runtime whose local zone is UTC. Two bugs followed:
 *
 *   1. "Sunday 23:59:59.999" was UTC, so a New York organizer's weekend boost
 *      ended 19:59 EDT — four hours early, on Sunday evening.
 *   2. `(7 - day) % 7 || 7` read the UTC day of week. A campaign bought
 *      Saturday 9pm EDT is Sunday 01:00 UTC, so `day === 0`, so the expression
 *      fell through to 7 and the boost ended the FOLLOWING Sunday — roughly
 *      eight days of delivery sold as a weekend.
 *
 * Mirrors packages/app/lib/ads/boost-schedule.ts, which carries the tests.
 */
function computeEndDate(
  startDate: Date,
  duration: string,
  timeZone = "UTC",
): Date {
  if (duration === "weekend") {
    const p = zonedParts(startDate, timeZone);
    // Buying on a Sunday gives that Sunday, not a whole extra week.
    const daysUntilSunday = (7 - p.weekday) % 7;
    return instantFromZoned(
      {
        year: p.year, month: p.month, day: p.day + daysUntilSunday,
        hour: 23, minute: 59, second: 59, ms: 999,
      },
      timeZone,
    );
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
      .select("id, title, host_id, event_tz")
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

    // Compute time window IN THE EVENT'S ZONE.
    //
    // `events.event_tz` is the IANA zone added by
    // migrations/20260708171038_events_event_tz.sql. It is nullable, and UTC is
    // the honest fallback: without a zone we cannot know when "the end of
    // Sunday" is for this organizer, and guessing the server's zone is exactly
    // what produced the eight-day weekend.
    const startsAt = start_now ? new Date() : new Date(); // TODO: scheduled start
    const eventTz =
      typeof event.event_tz === "string" && event.event_tz ? event.event_tz : "UTC";
    const endsAt = computeEndDate(startsAt, duration, eventTz);

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
