/**
 * cart-checkout Edge Function
 *
 * POST /cart-checkout
 * Body: { cartId }
 *
 * Verifies the buyer-owned cart has active holds, computes the server-truth
 * total, creates one Stripe PaymentIntent, and returns PaymentSheet params.
 * Deploy with --no-verify-jwt.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeFees } from "../_shared/fee-calculator.ts";
import {
  validateAndApplyPromo,
  incrementPromoUsage,
} from "../_shared/apply-promo-code.ts";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_PUBLISHABLE_KEY = Deno.env.get("STRIPE_PUBLISHABLE_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[cart-checkout] FATAL: STRIPE_SECRET_KEY env var is not set. Configure via: npx supabase secrets set STRIPE_SECRET_KEY=sk_...",
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CartRow = {
  id: string;
  user_id: string;
  event_id: number;
  status: "draft" | "holding" | "paying" | "completed" | "abandoned";
  stripe_pi_id?: string | null;
  currency: string;
  idempotency_key: string;
};

type CartLineItemRow = {
  id: string;
  cart_id: string;
  category: "admission" | "coat_check";
  tier_id: string;
  quantity: number;
  unit_price_cents: number;
  ticket_types?: {
    price_cents: number;
    currency?: string | null;
    event_id: number;
    name?: string | null;
    category?: string | null;
  } | null;
};

function parseCartId(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const cartId = String((input as Record<string, unknown>).cartId || "").trim();
  return UUID_RE.test(cartId) ? cartId : null;
}

async function stripeRequest(
  endpoint: string,
  body: Record<string, string>,
  options: { idempotencyKey?: string; stripeVersion?: string } = {},
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  if (options.stripeVersion) {
    headers["Stripe-Version"] = options.stripeVersion;
  }

  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || "Stripe request failed");
  }
  return data;
}

async function getOrCreateCustomer(
  supabase: any,
  userId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const { data: authUser } = await supabase
    .from("user")
    .select("id, name, email")
    .eq("id", userId)
    .maybeSingle();

  const params: Record<string, string> = {
    "metadata[dvnt_user_id]": userId,
  };
  if (authUser?.email) params.email = authUser.email;
  if (authUser?.name) params.name = authUser.name;

  const customer = await stripeRequest("/customers", params, {
    idempotencyKey: `customer_${userId}`,
  });

  await supabase.from("stripe_customers").upsert({
    user_id: userId,
    stripe_customer_id: customer.id,
  });

  return customer.id;
}

function requireCartReady(cart: CartRow): Response | null {
  if (cart.status === "completed") {
    return errorResponse("Cart already completed", 409);
  }
  if (cart.status === "abandoned") {
    return errorResponse("Cart is no longer active", 409);
  }
  if (cart.status !== "holding" && cart.status !== "paying") {
    return errorResponse("Create a cart hold before checkout", 409);
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  if (!STRIPE_SECRET_KEY) {
    return errorResponse(
      "Stripe is not configured for this environment. Contact support.",
      503,
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return errorResponse("Unauthorized", 401);

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return errorResponse("Invalid JSON", 400);
    }

    const cartId = parseCartId(parsed);
    if (!cartId) return errorResponse("Invalid cartId", 400);

    const promoCode =
      parsed && typeof parsed === "object"
        ? String((parsed as Record<string, unknown>).promoCode || "").trim()
        : "";

    console.log("[cart-checkout] checkout requested", {
      cartId,
      userId: authId,
    });

    const { data: cart, error: cartError } = await supabase
      .from("carts")
      .select(
        "id, user_id, event_id, status, stripe_pi_id, currency, idempotency_key",
      )
      .eq("id", cartId)
      .maybeSingle();

    if (cartError) {
      console.error("[cart-checkout] cart lookup failed", cartError);
      return errorResponse("Could not load cart", 500);
    }
    if (!cart || cart.user_id !== authId) {
      return errorResponse("Cart not found", 404);
    }

    const cartReadyError = requireCartReady(cart as CartRow);
    if (cartReadyError) return cartReadyError;

    const { data: lineItems, error: lineItemsError } = await supabase
      .from("cart_line_items")
      .select(
        "*, ticket_types(price_cents, currency, event_id, name, category)",
      )
      .eq("cart_id", cartId)
      .order("created_at", { ascending: true });

    if (lineItemsError) {
      console.error("[cart-checkout] line item lookup failed", lineItemsError);
      return errorResponse("Could not load cart line items", 500);
    }
    if (!lineItems?.length) return errorResponse("Cart is empty", 400);

    const { data: activeHolds, error: holdsError } = await supabase
      .from("cart_holds")
      .select("id, line_item_id, expires_at")
      .eq("cart_id", cartId)
      .eq("released", false)
      .gt("expires_at", new Date().toISOString());

    if (holdsError) {
      console.error("[cart-checkout] hold lookup failed", holdsError);
      return errorResponse("Could not verify cart hold", 500);
    }

    const heldLineItemIds = new Set(
      (activeHolds || []).map((hold: any) => hold.line_item_id),
    );
    const missingHold = (lineItems as CartLineItemRow[]).find(
      (item) => !heldLineItemIds.has(item.id),
    );
    if (missingHold) {
      await supabase.rpc("cart_release_hold", { p_cart_id: cartId });
      return jsonResponse(
        {
          error: "hold_expired",
          lineItemId: missingHold.id,
          tierId: missingHold.tier_id,
        },
        409,
      );
    }

    const currency = String(cart.currency || "usd").toLowerCase();
    let subtotalCents = 0;
    let quantity = 0;

    for (const item of lineItems as CartLineItemRow[]) {
      const tier = item.ticket_types;
      if (!tier || tier.event_id !== cart.event_id) {
        return errorResponse("Cart line item is invalid", 400);
      }
      const tierCurrency = String(tier.currency || currency).toLowerCase();
      if (tierCurrency !== currency) {
        return errorResponse("Cart contains mixed currencies", 400);
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return errorResponse("Cart line item quantity is invalid", 400);
      }
      if (!Number.isInteger(tier.price_cents) || tier.price_cents < 0) {
        return errorResponse("Cart line item price is invalid", 400);
      }

      subtotalCents += tier.price_cents * item.quantity;
      quantity += item.quantity;
    }

    if (subtotalCents <= 0) {
      return errorResponse("Cart total must be greater than zero", 400);
    }

    // Apply a promo code server-side (authoritative). The client only previews
    // the discount; this is what actually reduces the charge. Mirrors
    // create-payment-intent's flow via the shared validator.
    let promoResult = null;
    let discountCents = 0;
    if (promoCode) {
      const { result, error: promoErr } = await validateAndApplyPromo(
        supabase,
        cart.event_id,
        promoCode,
        null,
        subtotalCents,
        { quantity, userId: authId },
      );
      if (promoErr) return errorResponse(promoErr, 400);
      promoResult = result;
      discountCents = result?.discount_cents || 0;
    }

    const effectiveSubtotal = Math.max(0, subtotalCents - discountCents);
    if (effectiveSubtotal <= 0) {
      // A 100%-off code would zero the charge; the cart path issues tickets via
      // the Stripe webhook, so there's no $0-PI free-issuance route here yet.
      return errorResponse(
        "This code makes the order free, which isn't supported at checkout yet.",
        400,
      );
    }

    const fees = computeFees(effectiveSubtotal, quantity);

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, host_id, title")
      .eq("id", cart.event_id)
      .single();

    if (eventError || !event?.host_id) {
      return errorResponse("Event not found", 404);
    }

    const { data: organizer, error: organizerError } = await supabase
      .from("organizer_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("host_id", event.host_id)
      .maybeSingle();

    if (organizerError) {
      console.error("[cart-checkout] organizer lookup failed", organizerError);
      return errorResponse("Could not load organizer payment setup", 500);
    }
    if (!organizer?.stripe_account_id || !organizer?.charges_enabled) {
      return errorResponse("Organizer has not completed payment setup", 400);
    }

    const customerId = await getOrCreateCustomer(supabase, authId);
    const stripeIdempotencyKey = `cart_pi_${cart.idempotency_key}`;

    console.log("[cart-checkout] creating PaymentIntent", {
      cartId,
      subtotalCents: fees.subtotal,
      totalCents: fees.customer_charge_amount,
      quantity,
    });

    const piBody: Record<string, string> = {
      amount: fees.customer_charge_amount.toString(),
      currency,
      customer: customerId,
      "automatic_payment_methods[enabled]": "true",
      "transfer_data[destination]": organizer.stripe_account_id,
      application_fee_amount: fees.application_fee_amount.toString(),
      "metadata[type]": "cart_checkout",
      "metadata[cart_id]": cartId,
      "metadata[event_id]": String(cart.event_id),
      "metadata[user_id]": authId,
      "metadata[line_item_count]": String(lineItems.length),
      "metadata[quantity]": String(quantity),
      "metadata[subtotal_cents]": fees.subtotal.toString(),
      "metadata[buyer_fee_cents]": fees.buyer_fee.toString(),
      "metadata[organizer_fee_cents]": fees.organizer_fee.toString(),
      "metadata[dvnt_total_fee_cents]": fees.dvnt_total_fee.toString(),
      "metadata[fee_policy_version]": fees.fee_policy_version,
      "metadata[event_title]": String(event.title || "").substring(0, 500),
    };
    if (promoResult) {
      piBody["metadata[promo_code_id]"] = promoResult.promo_code_id;
      piBody["metadata[promo_code]"] = promoResult.code;
      piBody["metadata[discount_cents]"] = discountCents.toString();
    }

    const pi = await stripeRequest("/payment_intents", piBody, {
      idempotencyKey: stripeIdempotencyKey,
    });

    // Count the redemption once, on the first checkout transition (the cart is
    // still "holding"); retries arrive as "paying" and must not double-count.
    if (promoResult && (cart as CartRow).status === "holding") {
      await incrementPromoUsage(supabase, promoResult.promo_code_id);
    }

    const ephemeralKey = await stripeRequest(
      "/ephemeral_keys",
      { customer: customerId },
      { stripeVersion: "2026-02-25.clover" },
    );

    const holdExpiresAt = (activeHolds || [])
      .map((hold: any) => String(hold.expires_at))
      .sort()[0];

    const { error: cartUpdateError } = await supabase
      .from("carts")
      .update({
        status: "paying",
        stripe_pi_id: pi.id,
        total_cents: fees.customer_charge_amount,
        fee_cents: fees.buyer_fee,
        tax_cents: 0,
        currency,
      })
      .eq("id", cartId)
      .eq("user_id", authId);

    if (cartUpdateError) {
      console.error("[cart-checkout] cart update failed", cartUpdateError);
      return errorResponse("Could not save checkout state", 500);
    }

    const { error: orderError } = await supabase.from("orders").upsert(
      {
        cart_id: cartId,
        user_id: authId,
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
        event_id: cart.event_id,
        stripe_payment_intent_id: pi.id,
        ...(promoResult
          ? {
              promo_code_id: promoResult.promo_code_id,
              discount_cents: discountCents,
            }
          : {}),
      },
      { onConflict: "cart_id" },
    );

    if (orderError) {
      console.error("[cart-checkout] order upsert failed", orderError);
      return errorResponse("Could not save order", 500);
    }

    console.log("[cart-checkout] PaymentIntent ready", {
      cartId,
      paymentIntentId: pi.id,
    });

    return jsonResponse({
      ok: true,
      cartId,
      clientSecret: pi.client_secret,
      paymentIntent: pi.client_secret,
      paymentIntentId: pi.id,
      ephemeralKey: ephemeralKey.secret,
      customer: customerId,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      holdExpiresAt,
      totals: {
        subtotalCents: fees.subtotal,
        buyerFeeCents: fees.buyer_fee,
        discountCents,
        totalCents: fees.customer_charge_amount,
        currency,
      },
    });
  } catch (err) {
    console.error("[cart-checkout] unexpected", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal error",
      500,
    );
  }
});
