import { canAccessEvent } from "../_shared/event-access.ts";
/**
 * Create Payment Intent Edge Function
 *
 * POST /create-payment-intent
 * Body: { event_id, ticket_type_id, quantity, user_id }
 *
 * Returns: { paymentIntent, ephemeralKey, customer, publishableKey }
 *
 * Creates a Stripe PaymentIntent for the native PaymentSheet flow.
 * Also creates/retrieves a Stripe Customer and ephemeral key.
 * Reserves inventory via ticket_holds with 10-min TTL.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  computeFeesWithMode,
  MIN_TIER_PRICE_CENTS,
} from "../_shared/fee-calculator.ts";
import {
  enforceTierVisibility,
  TIER_VISIBILITY_MESSAGES,
} from "../_shared/tier-visibility.ts";
import { verifySession } from "../_shared/verify-session.ts";
import { createSignedQrPayload } from "../_shared/hmac-qr.ts";
import {
  validateAndApplyPromo,
  incrementPromoUsage,
} from "../_shared/apply-promo-code.ts";
import {
  validateAndApplyPromoterCode,
} from "../_shared/apply-promoter-code.ts";
import { withSentry } from "../_shared/sentry.ts";
import { isSalesClosed } from "../_shared/sales-cutoff.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_PUBLISHABLE_KEY = Deno.env.get("STRIPE_PUBLISHABLE_KEY") || "";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[create-payment-intent] FATAL: STRIPE_SECRET_KEY env var is not set on the edge function runtime. All checkout calls will return 503 until this is configured via: npx supabase secrets set STRIPE_SECRET_KEY=sk_...",
  );
}
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
  method = "POST",
): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method !== "GET" ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function stripeGet(endpoint: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

/**
 * Get or create a Stripe Customer for a DVNT user.
 *
 * Uses stripe_customers as a mapping cache, but VALIDATES the cached
 * customer exists in the current Stripe mode before reusing it. If the
 * project ever switches between test and live keys, the cached id from
 * the prior mode will fail with "No such customer: ...; a similar
 * object exists in test mode, but a live mode key was used" — caught
 * here, evicted, and a fresh customer is created on the spot.
 */
async function getOrCreateCustomer(
  supabase: any,
  userId: string,
): Promise<string> {
  // Check cache first
  const { data: existing } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.stripe_customer_id) {
    // Verify the cached customer still exists in the current Stripe
    // mode (live vs test). A 404 / wrong-mode response means we need
    // to evict the cache row and create a fresh customer below.
    const verifyRes = await fetch(
      `https://api.stripe.com/v1/customers/${existing.stripe_customer_id}`,
      { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } },
    );
    if (verifyRes.ok) {
      return existing.stripe_customer_id;
    }
    // Cache miss disguised as a hit — evict and fall through to create.
    console.warn(
      "[create-payment-intent] Stale stripe_customers cache for",
      userId,
      "→ evicting",
      existing.stripe_customer_id,
    );
    await supabase
      .from("stripe_customers")
      .delete()
      .eq("user_id", userId);
  }

  // Fetch user info for Stripe Customer creation
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

  // Cache the mapping
  await supabase.from("stripe_customers").upsert({
    user_id: userId,
    stripe_customer_id: customer.id,
  });

  return customer.id;
}

Deno.serve(withSentry("create-payment-intent", async (req: Request) => {
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

    const {
      event_id,
      ticket_type_id,
      quantity = 1,
      promo_code,
      promoter_code,
      unlock_code,
    } = await req.json();

    if (!event_id || !ticket_type_id) {
      return json({ error: "Missing required fields" }, 400);
    }

    if (!await canAccessEvent(supabase, Number(event_id), user_id)) {
      return json({ error: "Event not found or invitation required" }, 404);
    }

    // Sales cutoff: card-not-present sales stop 30 min before event end —
    // Tap to Pay is the only exception after that.
    const { data: cutoffEvent } = await supabase
      .from("events")
      .select("end_date, start_date")
      .eq("id", Number(event_id))
      .maybeSingle();
    if (isSalesClosed(cutoffEvent)) {
      return json({ error: "Ticket sales have ended for this event." }, 400);
    }

    // Promoter attribution code (WS-4 / Phase 2) — from a tracked ?ref= link.
    // A valid promoter code now BOTH attributes the order AND gives the
    // buyer a customer discount. The discount is computed server-side and
    // locked on the order; the webhook records attribution + commission.
    const promoterCodeRaw =
      typeof promoter_code === "string"
        ? promoter_code.trim().toUpperCase().slice(0, 32)
        : "";
    const validPromoterCode = /^[A-Z0-9_-]{2,32}$/.test(promoterCodeRaw)
      ? promoterCodeRaw
      : "";

    if (!Number.isInteger(quantity) || quantity < 1) {
      return json({ error: "Invalid quantity" }, 400);
    }

    // ── Fetch ticket type (scoped to event to prevent cross-event manipulation) ──
    const { data: ticketType, error: ttError } = await supabase
      .from("ticket_types")
      .select("*")
      .eq("id", ticket_type_id)
      .eq("event_id", parseInt(event_id))
      .single();

    if (ttError || !ticketType)
      return json({ error: "Ticket type not found for this event" }, 404);

    // ── Tier visibility guard (mirror of cart_create_hold v3) ──
    // This rail inserts ticket_holds directly, bypassing the RPC's
    // hidden/locked enforcement — so enforce it here. Never echo the code.
    const visibilityError = await enforceTierVisibility(
      supabase,
      ticketType,
      unlock_code,
    );
    if (visibilityError) {
      return json(
        {
          error: TIER_VISIBILITY_MESSAGES[visibilityError],
          code: visibilityError,
        },
        visibilityError === "tier_hidden" ? 404 : 403,
      );
    }

    // ── Availability ─────────────────────────────────────────
    // The real check is now the atomic one at the hold below
    // (ticket_hold_create_atomic: locks the tier, sums BOTH cart_holds and
    // ticket_holds by seat). This early read stays only so an obviously
    // sold-out tier fails before we bother Stripe — it is advisory, and
    // deliberately NOT the thing inventory correctness rests on.
    const remaining =
      (ticketType.quantity_total ?? Infinity) - (ticketType.quantity_sold || 0);
    if (quantity > remaining) {
      return json({ error: "Not enough tickets available" }, 400);
    }

    // ── Check max per user (including already-owned tickets) ──
    const maxPerUser = ticketType.max_per_user || 4;
    const { count: ownedCount } = await supabase
      .from("tickets")
      .select("*", { count: "exact", head: true })
      .eq("ticket_type_id", ticket_type_id)
      .eq("user_id", user_id)
      .in("status", ["active", "scanned", "transfer_pending"]);

    if ((ownedCount || 0) + quantity > maxPerUser) {
      const remaining = maxPerUser - (ownedCount || 0);
      return json(
        {
          error:
            remaining <= 0
              ? `You already have the maximum ${maxPerUser} tickets`
              : `You can only buy ${remaining} more (max ${maxPerUser} per person)`,
        },
        400,
      );
    }

    // ── Promoter + promo code validation (before free/paid branching) ────
    const rawSubtotal = ticketType.price_cents * quantity;
    let promoResult: any = null;
    let promoterResult: any = null;
    let discountCents = 0;

    // Promoter discount is applied first; the post-promoter subtotal is the
    // commission basis and also the base for any additional promo code.
    if (validPromoterCode) {
      const { result, error: promoterErr } = await validateAndApplyPromoterCode(
        supabase,
        parseInt(event_id),
        validPromoterCode,
        rawSubtotal,
        quantity,
      );
      if (promoterErr) return json({ error: promoterErr }, 400);
      promoterResult = result;
      discountCents += promoterResult?.discount_cents || 0;
    }

    const subtotalAfterPromoter = Math.max(0, rawSubtotal - discountCents);

    if (promo_code) {
      const { result, error: promoErr } = await validateAndApplyPromo(
        supabase,
        parseInt(event_id),
        promo_code,
        ticket_type_id,
        subtotalAfterPromoter,
        { quantity, userId: user_id },
      );
      if (promoErr) return json({ error: promoErr }, 400);
      promoResult = result;
      discountCents += promoResult?.discount_cents || 0;
    }

    const effectiveSubtotal = Math.max(0, rawSubtotal - discountCents);

    // ── Free tickets (or fully discounted): issue directly ────
    if (effectiveSubtotal === 0) {
      const tickets = [];
      const eventIdInt = parseInt(event_id);
      for (let i = 0; i < quantity; i++) {
        const ticketUuid = crypto.randomUUID();
        const { qrToken, qrPayload } = await createSignedQrPayload(
          ticketUuid,
          eventIdInt,
        );
        tickets.push({
          id: ticketUuid,
          event_id: eventIdInt,
          ticket_type_id,
          user_id,
          status: "active",
          qr_token: qrToken,
          qr_payload: qrPayload,
          purchase_amount_cents: 0,
        });
      }

      const { data: issued, error: issueError } = await supabase
        .from("tickets")
        .insert(tickets)
        .select("id, qr_token");

      if (issueError) throw issueError;

      await supabase
        .from("ticket_types")
        .update({ quantity_sold: (ticketType.quantity_sold || 0) + quantity })
        .eq("id", ticket_type_id);

      // Increment promo usage if a promo was used
      if (promoResult) {
        await incrementPromoUsage(supabase, promoResult.promo_code_id);
      }

      const { data: freeOrder } = await supabase
        .from("orders")
        .insert({
          user_id,
          type: "event_ticket",
          status: "paid",
          subtotal_cents: 0,
          total_cents: 0,
          event_id: parseInt(event_id),
          paid_at: new Date().toISOString(),
          ...(promoResult
            ? {
                promo_code_id: promoResult.promo_code_id,
                discount_cents: discountCents,
              }
            : {}),
          ...(promoterResult
            ? {
                promoter_policy_version: "v2_eligible_subtotal_after_discount",
                promoter_original_amount_cents: rawSubtotal,
                promoter_customer_discount_bps: promoterResult.customer_discount_bps,
                promoter_discount_amount_cents: promoterResult.discount_cents,
                promoter_discounted_amount_cents: promoterResult.discounted_amount_cents,
                promoter_code: promoterResult.code,
                promoter_commission_bps: promoterResult.promoter_commission_bps,
                promoter_commission_amount_cents: 0,
              }
            : {}),
        })
        .select("id")
        .single();

      if (freeOrder?.id) {
        await supabase.from("order_timeline").insert([
          { order_id: freeOrder.id, type: "created", label: "Order created" },
          {
            order_id: freeOrder.id,
            type: "payment_captured",
            label: promoResult
              ? "Free ticket issued (100% promo discount)"
              : "Free ticket issued",
          },
        ]);

        // Promoter attribution for free orders — no webhook fires for
        // a $0 order. Earning is 0 so no ledger row; attribution still
        // counts toward promoter order stats. Idempotent server-side.
        if (validPromoterCode) {
          try {
            await supabase.rpc("record_promoter_attribution", {
              p_order_id: freeOrder.id,
              p_code: validPromoterCode,
            });
          } catch (attrErr) {
            console.error(
              "[create-payment-intent] free-order promoter attribution failed:",
              attrErr,
            );
          }
        }
      }

      return json({ tickets: issued, free: true });
    }

    // ── Paid tickets: PaymentIntent flow ─────────────────────

    // Fetch event + organizer
    const { data: event } = await supabase
      .from("events")
      .select("host_id, title, fee_mode")
      .eq("id", parseInt(event_id))
      .single();

    if (!event?.host_id) return json({ error: "Event not found" }, 404);

    const { data: organizer } = await supabase
      .from("organizer_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("host_id", event.host_id)
      .single();

    if (!organizer?.stripe_account_id || !organizer?.charges_enabled) {
      return json({ error: "Organizer has not completed payment setup" }, 400);
    }

    // ── Fee structure (v1_250_1pt) ──────────────────────────────
    const subtotalCents = effectiveSubtotal;
    // Defensive floor: catch any tier that slipped past the client price
    // floor before we attempt computeFees (which throws on negative
    // organizer transfer). Returns a clear, actionable error instead of
    // a generic 500.
    if (ticketType.price_cents > 0 && ticketType.price_cents < MIN_TIER_PRICE_CENTS) {
      return json(
        {
          error:
            "This ticket is priced below the minimum required to cover platform fees. Ask the organizer to raise the price to at least $2.00.",
        },
        400,
      );
    }
    // fee_mode-aware (absorb|pass): in absorb the buyer is charged just
    // the subtotal and the organizer's transfer eats the buyer-side fee;
    // application_fee (DVNT's 5% + $2) is unchanged. Shared entry point.
    const fees = computeFeesWithMode(subtotalCents, quantity, event.fee_mode);

    // ── Get or create Stripe Customer ────────────────────
    const customerId = await getOrCreateCustomer(supabase, user_id);

    // ── Create idempotency key ────────────────────────
    const idempotencyKey = `pi_${user_id}_${event_id}_${ticket_type_id}_${quantity}_${Date.now()}`;

    // ── Create PaymentIntent ───────────────────────────
    const pi = await stripeRequest("/payment_intents", {
      amount: fees.customer_charge_amount.toString(),
      currency: ticketType.currency || "usd",
      customer: customerId,
      // Use automatic_payment_methods so Stripe dynamically chooses
      // which methods to surface based on:
      //   - the amount (Affirm needs $35+, Klarna has its own floors)
      //   - the currency + buyer region
      //   - what's enabled in the Stripe Dashboard (single source of
      //     truth — crypto is OFF in Dashboard so it stays off here)
      // The explicit-allowlist approach broke checkout for sub-$35
      // tickets because Stripe rejects the PI if ANY listed method is
      // ineligible at that amount. Dashboard-driven is the correct
      // Stripe-recommended pattern for PaymentSheet.
      "automatic_payment_methods[enabled]": "true",
      // allow_redirects=always keeps BNPL methods (Klarna/Afterpay/
      // Affirm) available on amounts where they qualify, by allowing
      // the redirect handshake those methods need. The client side
      // returnURL ("dvnt://tickets/success") handles bringing the
      // user back into the app.
      "automatic_payment_methods[allow_redirects]": "always",
      "transfer_data[destination]": organizer.stripe_account_id,
      application_fee_amount: fees.application_fee_amount.toString(),
      "metadata[type]": "event_ticket",
      "metadata[event_id]": event_id.toString(),
      "metadata[ticket_type_id]": ticket_type_id,
      "metadata[user_id]": user_id,
      "metadata[quantity]": quantity.toString(),
      "metadata[subtotal_cents]": fees.subtotal.toString(),
      "metadata[buyer_fee_cents]": fees.buyer_fee.toString(),
      "metadata[organizer_fee_cents]": fees.organizer_fee.toString(),
      "metadata[dvnt_total_fee_cents]": fees.dvnt_total_fee.toString(),
      "metadata[fee_policy_version]": fees.fee_policy_version,
      "metadata[fee_mode]": fees.fee_mode,
      "metadata[event_title]": (event.title || "").substring(0, 500),
      ...(promoResult
        ? {
            "metadata[promo_code_id]": promoResult.promo_code_id,
            "metadata[discount_cents]": discountCents.toString(),
            "metadata[promo_code]": promoResult.code,
          }
        : {}),
      ...(validPromoterCode
        ? { "metadata[dvnt_promoter_code]": validPromoterCode }
        : {}),
    });

    // ── Create ephemeral key for PaymentSheet ────────────────
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

    // ── Create inventory hold (ATOMIC) ──────────────────
    // Locks the tier row and sums BOTH cart_holds and ticket_holds by seat,
    // so the last seat can only be claimed once. The plain INSERT this
    // replaces trusted a count read before the Stripe round trip above, which
    // let two simultaneous buyers hold the same seat — and never looked at
    // cart_holds at all, so the cart rail's reservations were invisible.
    const holdExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: holdResult, error: holdRpcError } = await supabase.rpc(
      "ticket_hold_create_atomic",
      {
        p_ticket_type_id: ticket_type_id,
        p_quantity: quantity,
        p_payment_intent_id: pi.id,
        p_user_id: user_id,
        p_hold_seconds: 600,
      },
    );

    if (holdRpcError || !holdResult?.ok) {
      // Someone took the seat while Stripe was minting the intent. Cancel the
      // PaymentIntent so the buyer is never left holding an uncancelled
      // intent for inventory they cannot have.
      try {
        await stripeRequest(`/payment_intents/${pi.id}/cancel`, {});
      } catch (e) {
        console.error(
          "[create-payment-intent] hold failed AND PI cancel failed",
          pi.id,
          e,
        );
      }
      const available = holdResult?.available;
      return json(
        {
          error:
            typeof available === "number" && available > 0
              ? `Only ${available} left — reduce your quantity and try again.`
              : "Those tickets just sold out.",
        },
        409,
      );
    }

    // ── Increment promo usage ───────────────────────────
    // Only after the hold is secured. Still ahead of payment — see the
    // note in stripe-webhook's payment_intent.succeeded handler.
    if (promoResult) {
      await incrementPromoUsage(supabase, promoResult.promo_code_id);
    }

    // ── Create order row in payment_pending state (fee components stored) ──
    await supabase.from("orders").insert({
      user_id,
      type: "event_ticket",
      status: "payment_pending",
      quantity,
      subtotal_cents: fees.subtotal,
      platform_fee_cents: fees.dvnt_total_fee,
      total_cents: fees.customer_charge_amount,
      buyer_pct_fee_cents: fees.buyer_pct_fee,
      buyer_per_ticket_fee_cents: fees.buyer_per_ticket_fee,
      buyer_fee_cents: fees.buyer_fee,
      org_pct_fee_cents: fees.org_pct_fee,
      org_per_ticket_fee_cents: fees.org_per_ticket_fee,
      organizer_fee_cents: fees.organizer_fee,
      dvnt_total_fee_cents: fees.dvnt_total_fee,
      fee_policy_version: fees.fee_policy_version,
      event_id: parseInt(event_id),
      stripe_payment_intent_id: pi.id,
      ...(promoResult
        ? {
            promo_code_id: promoResult.promo_code_id,
            discount_cents: discountCents,
          }
        : {}),
      ...(promoterResult
        ? {
            promoter_policy_version: "v2_eligible_subtotal_after_discount",
            promoter_original_amount_cents: rawSubtotal,
            promoter_customer_discount_bps: promoterResult.customer_discount_bps,
            promoter_discount_amount_cents: promoterResult.discount_cents,
            promoter_discounted_amount_cents: promoterResult.discounted_amount_cents,
            promoter_code: promoterResult.code,
            promoter_commission_bps: promoterResult.promoter_commission_bps,
            promoter_commission_amount_cents: promoterResult.commission_cents,
          }
        : {}),
    });

    return json({
      paymentIntent: pi.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customerId,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      paymentIntentId: pi.id,
    });
  } catch (err: any) {
    console.error("[create-payment-intent] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
}));
