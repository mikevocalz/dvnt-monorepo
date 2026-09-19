/**
 * Door Sell Edge Function — web Door POS "Sell" rail.
 *
 * POST /door-sell
 *   { action: "quote", event_id, ticket_type_id, quantity,
 *     promoter_code?, promo_code? }
 *     → server quote only: { quote }. Creates nothing.
 *
 *   { action: "sell", event_id, ticket_type_id, quantity,
 *     guest_email, guest_name?, promoter_code?, promo_code? }
 *     → creates atomic ticket hold + PaymentIntent + payment_pending
 *       order; returns { clientSecret, publishableKey, quote, order_id }.
 *       Zero-total orders take the secure free path: guest tickets are
 *       issued immediately with no Stripe object ("No charge").
 *
 * Money-path rules honored:
 *  - Staff only: host or accepted event_co_organizers (scanner+). The
 *    seller id comes from the verified session, never the body.
 *  - Client amounts are ignored; every figure is recomputed here.
 *  - Same atomic hold RPC as online checkout (ticket_hold_create_atomic)
 *    — door and online race the same inventory.
 *  - Web PaymentIntents use automatic_payment_methods only; never
 *    payment_method_types (those are for the Terminal rail).
 *  - Buyer is the guest email; the order rows the seller via
 *    sold_by_staff_user_id. Tickets mint for the guest, not the seller.
 *  - Fulfillment stays webhook-driven (payment_intent.succeeded →
 *    metadata.type "event_ticket" + is_door_sale).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeFeesWithMode } from "../_shared/fee-calculator.ts";
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
import { validateAndApplyPromoterCode } from "../_shared/apply-promoter-code.ts";
import { maybeFireCapacityAlerts } from "../_shared/capacity-alerts.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { deliverTicketBundleEmail } from "../_shared/ticket-email-delivery.ts";
import {
  canSellAtDoor,
  doorGuestTicketBase,
} from "../_shared/door-sale.ts";
import { withSentry } from "../_shared/sentry.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_PUBLISHABLE_KEY = Deno.env.get("STRIPE_PUBLISHABLE_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
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

Deno.serve(withSentry("door-sell", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-auth-token",
      },
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!STRIPE_SECRET_KEY) {
    return json({ error: "Stripe is not configured for this environment." }, 503);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    // ── Staff auth — always required. There is no guest seller. ──────
    const staffUserId = await verifySession(supabase, req);
    if (!staffUserId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const {
      action,
      event_id,
      ticket_type_id,
      quantity = 1,
      guest_email,
      guest_name,
      promo_code,
      promoter_code,
      unlock_code,
      order_id,
    } = body;

    if (!["quote", "sell", "status", "resend"].includes(action)) {
      return json(
        { error: "action must be 'quote', 'sell', 'status' or 'resend'" },
        400,
      );
    }
    if (
      !event_id ||
      (action !== "status" && action !== "resend" && !ticket_type_id)
    ) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (
      action !== "resend" &&
      (!Number.isInteger(quantity) || quantity < 1 || quantity > 20)
    ) {
      return json({ error: "Invalid quantity" }, 400);
    }
    const eventId = parseInt(event_id);

    const trimmedGuestEmail =
      typeof guest_email === "string" ? guest_email.trim().toLowerCase() : "";
    const trimmedGuestName =
      typeof guest_name === "string" ? guest_name.trim().slice(0, 120) : "";
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedGuestEmail);
    if (action === "sell" && (!isValidEmail || trimmedGuestEmail.length > 254)) {
      return json(
        { error: "Enter an email to send the tickets to." },
        400,
      );
    }

    const trimmedPromoterCode =
      typeof promoter_code === "string"
        ? promoter_code.trim().toUpperCase().slice(0, 32)
        : "";
    const validPromoterCode = /^[A-Z0-9_-]{2,32}$/.test(trimmedPromoterCode)
      ? trimmedPromoterCode
      : "";

    // ── Staff authorization: host or accepted co-organizer (scanner+). ──
    const { data: event } = await supabase
      .from("events")
      .select("host_id, title, fee_mode")
      .eq("id", eventId)
      .single();
    if (!event?.host_id) return json({ error: "Event not found" }, 404);

    const isHost = String(event.host_id) === String(staffUserId);
    let staffRole: string | null = isHost ? "owner" : null;
    if (!isHost) {
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role, accepted")
        .eq("event_id", eventId)
        .eq("user_id", staffUserId)
        .eq("accepted", true)
        .in("role", ["scanner", "editor", "admin"])
        .maybeSingle();
      staffRole = coOrg?.role ?? null;
    }
    const authorized = canSellAtDoor(isHost, staffRole);
    if (!authorized) {
      return json({ error: "Your access to this event ended." }, 403);
    }

    // Order status for the success screen — tells the seller whether the
    // webhook has actually issued the tickets instead of a client-side
    // timer pretending fulfillment happened. Staff-scoped to this event.
    if (action === "status") {
      if (!order_id) return json({ error: "Missing order_id" }, 400);
      const { data: order } = await supabase
        .from("orders")
        .select(
          "id, status, quantity, stripe_payment_intent_id, " +
            "ticket_email_status, guest_email",
        )
        .eq("id", order_id)
        .eq("event_id", eventId)
        .single();
      if (!order) return json({ error: "Order not found" }, 404);
      // Tickets link to the order via order_id (or the PaymentIntent on
      // pre-migration rows). Free orders have no PI; their 'paid' status
      // IS issuance.
      let issued = order.status === "paid" && !order.stripe_payment_intent_id
        ? order.quantity
        : 0;
      if (order.stripe_payment_intent_id) {
        const { count } = await supabase
          .from("tickets")
          .select("*", { count: "exact", head: true })
          .eq("stripe_payment_intent_id", order.stripe_payment_intent_id);
        issued = count ?? 0;
      }
      return json({
        ok: true,
        status: order.status,
        quantity: order.quantity,
        tickets_issued: issued,
        ticket_email_status: order.ticket_email_status ?? null,
      });
    }

    // ── Resend tickets — RE-EMAIL the order's existing bundle. Never
    // mints tickets, never creates an order, never touches Stripe. The
    // delivery module rebuilds the canonical bundle from the order's
    // authoritative ticket rows and sends it again (force), recording a
    // manual_resend audit entry. ──────────────────────────────────────
    if (action === "resend") {
      if (!order_id) return json({ error: "Missing order_id" }, 400);
      const { data: order } = await supabase
        .from("orders")
        .select("id, status, guest_email")
        .eq("id", order_id)
        .eq("event_id", eventId)
        .single();
      if (!order) return json({ error: "Order not found" }, 404);
      if (order.status !== "paid") {
        return json({ error: "This order isn't paid — nothing to resend." }, 409);
      }
      if (!order.guest_email) {
        return json({ error: "This order has no guest email to send to." }, 409);
      }
      const result = await deliverTicketBundleEmail(supabase, order.id, {
        force: true,
        kind: "manual_resend",
        logPrefix: "[door-sell]",
      });
      if (!result.ok) {
        return json(
          { error: "Resend failed — the guest can also use ticket lookup.", code: result.reason },
          502,
        );
      }
      return json({ ok: true, resent: true });
    }

    // Rate-limit per seller — a door seller shouldn't mint hundreds of
    // holds; each active hold blocks inventory for 10 minutes.
    const rl = checkRateLimit(`door:${staffUserId}`, "door-sell", {
      maxRequests: 30,
      windowMs: 10 * 60_000,
    });
    if (!rl.allowed) {
      return json(
        {
          error: `Too many sale attempts. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
        },
        429,
      );
    }

    // ── Tier + window + visibility ────────────────────────────────────
    const { data: ticketType, error: ttError } = await supabase
      .from("ticket_types")
      .select("*")
      .eq("id", ticket_type_id)
      .eq("event_id", eventId)
      .single();
    if (ttError || !ticketType) {
      return json({ error: "Ticket type not found for this event" }, 404);
    }

    const now = new Date();
    if (ticketType.sale_start && now < new Date(ticketType.sale_start)) {
      return json({ error: "This tier is not on sale yet." }, 400);
    }
    if (ticketType.sale_end && now >= new Date(ticketType.sale_end)) {
      return json({ error: "Sales for this tier have ended." }, 400);
    }

    const visibilityError = await enforceTierVisibility(
      supabase,
      ticketType,
      unlock_code,
    );
    if (visibilityError) {
      return json(
        { error: TIER_VISIBILITY_MESSAGES[visibilityError], code: visibilityError },
        visibilityError === "tier_hidden" ? 404 : 403,
      );
    }

    // Per-guest cap — same rule as ticket-checkout: active/scanned/
    // transfer_pending tickets for this guest email count against
    // max_per_user. Applies to quote and sell so the UI can't promise a
    // quantity the sell call would refuse.
    if (isValidEmail) {
      const maxPerGuest = ticketType.max_per_user || 4;
      const { count: guestOwned } = await supabase
        .from("tickets")
        .select("*", { count: "exact", head: true })
        .eq("ticket_type_id", ticket_type_id)
        .eq("guest_email", trimmedGuestEmail)
        .in("status", ["active", "scanned", "transfer_pending"]);
      if ((guestOwned || 0) + quantity > maxPerGuest) {
        const left = maxPerGuest - (guestOwned || 0);
        return json({
          error: left <= 0
            ? `This guest already has the maximum ${maxPerGuest} tickets for this tier`
            : `This guest can only take ${left} more (max ${maxPerGuest} per person)`,
          code: "max_per_guest",
        }, 400);
      }
    }

    // ── Codes: promoter first (commission basis), then promo ──────────
    const rawSubtotal = ticketType.price_cents * quantity;
    let promoResult: any = null;
    let promoterResult: any = null;
    let discountCents = 0;

    if (validPromoterCode) {
      const { result, error: promoterErr } = await validateAndApplyPromoterCode(
        supabase,
        eventId,
        validPromoterCode,
        rawSubtotal,
        quantity,
      );
      if (promoterErr) return json({ error: promoterErr, code: "code_invalid" }, 400);
      promoterResult = result;
      discountCents += promoterResult?.discount_cents || 0;
    }

    const subtotalAfterPromoter = Math.max(0, rawSubtotal - discountCents);
    if (promo_code) {
      const { result, error: promoErr } = await validateAndApplyPromo(
        supabase,
        eventId,
        promo_code,
        ticket_type_id,
        subtotalAfterPromoter,
      );
      if (promoErr) return json({ error: promoErr, code: "code_invalid" }, 400);
      promoResult = result;
      discountCents += promoResult?.discount_cents || 0;
    }

    const effectiveSubtotal = Math.max(0, rawSubtotal - discountCents);

    // Server-side remaining — same inventory the atomic hold counts:
    // sold + live ticket_holds + live cart_holds. The client's
    // total-minus-sold estimate ignores holds and can promise the last
    // seat to two sellers at once.
    const nowIso = now.toISOString();
    const [{ data: liveTicketHolds }, { data: liveCartHolds }] =
      await Promise.all([
        supabase
          .from("ticket_holds")
          .select("quantity")
          .eq("ticket_type_id", ticket_type_id)
          .eq("status", "active")
          .gt("expires_at", nowIso),
        supabase
          .from("cart_holds")
          .select("qty")
          .eq("tier_id", ticket_type_id)
          .eq("released", false)
          .gt("expires_at", nowIso),
      ]);
    const held =
      (liveTicketHolds || []).reduce(
        (s: number, h: { quantity?: number }) => s + (h.quantity || 0),
        0,
      ) +
      (liveCartHolds || []).reduce(
        (s: number, h: { qty?: number }) => s + (h.qty || 0),
        0,
      );
    const remaining = typeof ticketType.quantity_total === "number"
      ? ticketType.quantity_total - (ticketType.quantity_sold || 0) - held
      : null;

    // Fees decide the customer-facing total. Zero-total quotes never hit
    // Stripe.
    const fees = effectiveSubtotal === 0 ? null : computeFeesWithMode(
      effectiveSubtotal,
      quantity,
      event.fee_mode,
    );
    const quote = {
      currency: ticketType.currency || "usd",
      subtotal_cents: rawSubtotal,
      discount_cents: discountCents,
      discounted_subtotal_cents: effectiveSubtotal,
      fee_cents: fees?.buyer_fee ?? 0,
      total_cents:
        fees?.customer_charge_amount ?? 0,
      code: validPromoterCode || (promoResult?.code ?? null),
      quantity,
      remaining,
    };

    if (action === "quote") {
      return json({ ok: true, quote, role: staffRole });
    }

    // ── action === "sell" ──────────────────────────────────────────────

    // Zero-total: secure free path — no Stripe object, real guest tickets.
    if (effectiveSubtotal === 0) {
      const ticketRows = [];
      for (let i = 0; i < quantity; i++) {
        const ticketUuid = crypto.randomUUID();
        const { qrToken, qrPayload } = await createSignedQrPayload(
          ticketUuid,
          eventId,
        );
        ticketRows.push({
          ...doorGuestTicketBase.build({
            eventId,
            ticketTypeId: ticket_type_id,
            guestEmail: trimmedGuestEmail,
            guestName: trimmedGuestName || null,
            paymentIntentId: `free_${crypto.randomUUID()}`,
            quantity,
            amountCents: 0,
            index: i,
          }),
          id: ticketUuid,
          qr_token: qrToken,
          qr_payload: qrPayload,
          stripe_payment_intent_id: null,
        });
      }
      const { data: freeSale, error: freeSaleError } = await supabase.rpc(
        "door_free_sale_atomic", {
          p_ticket_type_id: ticket_type_id,
          p_ticket_rows: ticketRows,
          p_order: {
            user_id: null,
            guest_email: trimmedGuestEmail,
            type: "event_ticket",
            status: "paid",
            quantity,
            subtotal_cents: 0,
            total_cents: 0,
            event_id: eventId,
            paid_at: new Date().toISOString(),
            sold_by_staff_user_id: staffUserId,
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
                  promoter_customer_discount_bps:
                    promoterResult.customer_discount_bps,
                  promoter_discount_amount_cents: promoterResult.discount_cents,
                  promoter_discounted_amount_cents:
                    promoterResult.discounted_amount_cents,
                  promoter_code: promoterResult.code,
                  promoter_commission_bps: promoterResult.promoter_commission_bps,
                  promoter_commission_amount_cents: 0,
                }
              : {}),
            currency: ticketType.currency || "usd",
          },
        },
      );
      // Missing RPC or any SQL error fails closed: no separate inserts.
      if (freeSaleError) throw freeSaleError;
      if (!freeSale?.ok) {
        return json({ error: "Not enough tickets available", code: "sold_out" }, 409);
      }
      const freeOrder = { id: freeSale.order_id };
      const issued = freeSale.tickets;
      try {
        await maybeFireCapacityAlerts(supabase, { eventId, ticketTypeId: ticket_type_id });
        if (promoResult) await incrementPromoUsage(supabase, promoResult.promo_code_id);
      } catch (sideEffectError) {
        // The sale committed. Do not report failure and invite a second sale.
        console.error("[door-sell] free sale follow-up failed", sideEffectError);
      }
      // ONE bundle email from the order's authoritative ticket rows —
      // same path as paid door sales + hosted checkout. Failure is
      // persisted as retryable delivery state, never a rollback.
      if (freeOrder?.id) {
        await deliverTicketBundleEmail(supabase, freeOrder.id, {
          kind: "fulfillment",
          logPrefix: "[door-sell]",
        });
      }

      if (freeOrder?.id && validPromoterCode) {
        try {
          await supabase.rpc("record_promoter_attribution", {
            p_order_id: freeOrder.id,
            p_code: validPromoterCode,
          });
        } catch (attrErr) {
          console.error("[door-sell] free-order attribution failed:", attrErr);
        }
      }
      return json({
        ok: true,
        free: true,
        order_id: freeOrder?.id ?? null,
        tickets_issued: issued?.length ?? 0,
        quote,
      });
    }

    if (!fees) throw new Error("Missing paid-sale fees");

    // ── Paid: organizer account must be live ──────────────────────────
    const { data: organizer } = await supabase
      .from("organizer_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("host_id", event.host_id)
      .single();
    if (!organizer?.stripe_account_id || !organizer?.charges_enabled) {
      return json(
        {
          error:
            "This event can't take payments yet. The organizer hasn't finished setup.",
          code: "payments_not_ready",
        },
        400,
      );
    }

    // ── PaymentIntent — web rail: automatic_payment_methods only ──────
    // Minted BEFORE the hold so the hold binds the real PI id in one
    // write — a placeholder-then-rebind pattern can collide with another
    // seller's concurrent hold on the same tier.
    let pi: any;
    try {
      pi = await stripeRequest("/payment_intents", {
        amount: fees.customer_charge_amount.toString(),
        currency: ticketType.currency || "usd",
        "automatic_payment_methods[enabled]": "true",
        "transfer_data[destination]": organizer.stripe_account_id,
        application_fee_amount: fees.application_fee_amount.toString(),
        receipt_email: trimmedGuestEmail,
        "metadata[type]": "event_ticket",
        "metadata[is_door_sale]": "true",
        "metadata[event_id]": event_id.toString(),
        "metadata[ticket_type_id]": ticket_type_id,
        "metadata[quantity]": quantity.toString(),
        "metadata[guest_email]": trimmedGuestEmail,
        "metadata[guest_name]": trimmedGuestName,
        "metadata[sold_by_staff_user_id]": staffUserId,
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
    } catch (stripeErr) {
      throw stripeErr;
    }

    // ── Atomic inventory hold — same RPC as online checkout ────────────
    const { data: holdResult, error: holdRpcError } = await supabase.rpc(
      "ticket_hold_create_atomic",
      {
        p_ticket_type_id: ticket_type_id,
        p_quantity: quantity,
        p_payment_intent_id: pi.id,
        p_user_id: staffUserId,
        p_hold_seconds: 600,
      },
    );
    if (holdRpcError || !holdResult?.ok) {
      // Someone took the seat while Stripe was minting the intent. Cancel
      // the PaymentIntent so the guest is never left with an uncancelled
      // intent for inventory they cannot have. (Mirrors
      // create-payment-intent.)
      try {
        await stripeRequest(`/payment_intents/${pi.id}/cancel`, {});
      } catch (e) {
        console.error(
          "[door-sell] hold failed AND PI cancel failed",
          pi.id,
          e,
        );
      }
      const available = holdResult?.available;
      return json(
        {
          error:
            typeof available === "number" && available > 0
              ? `Only ${available} left — reduce the quantity and try again.`
              : `${ticketType.name || "This tier"} sold out while you were selling.`,
          code: "sold_out",
        },
        409,
      );
    }

    if (promoResult) {
      await incrementPromoUsage(supabase, promoResult.promo_code_id);
    }

    // ── Order row — payment_pending, seller + guest recorded ──────────
    // If this fails with a live PI + hold, undo both: an intent with no
    // order is a charge the webhook cannot reconcile to a seller.
    const { data: orderRow, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: null,
        guest_email: trimmedGuestEmail,
        type: "event_ticket",
        status: "payment_pending",
        quantity,
        subtotal_cents: fees.subtotal,
        platform_fee_cents: fees.dvnt_total_fee,
        total_cents: fees.customer_charge_amount,
        buyer_pct_fee_cents: fees.buyer_pct_fee,
        buyer_per_ticket_fee_cents: fees.buyer_per_ticket_fee,
        buyer_fee_cents: fees?.buyer_fee ?? 0,
        org_pct_fee_cents: fees.org_pct_fee,
        org_per_ticket_fee_cents: fees.org_per_ticket_fee,
        organizer_fee_cents: fees.organizer_fee,
        dvnt_total_fee_cents: fees.dvnt_total_fee,
        fee_policy_version: fees.fee_policy_version,
        event_id: eventId,
        stripe_payment_intent_id: pi.id,
        sold_by_staff_user_id: staffUserId,
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
              promoter_customer_discount_bps:
                promoterResult.customer_discount_bps,
              promoter_discount_amount_cents: promoterResult.discount_cents,
              promoter_discounted_amount_cents:
                promoterResult.discounted_amount_cents,
              promoter_code: promoterResult.code,
              promoter_commission_bps: promoterResult.promoter_commission_bps,
              promoter_commission_amount_cents: promoterResult.commission_cents,
            }
          : {}),
      })
      .select("id")
      .single();
    if (orderError) {
      try {
        await stripeRequest(`/payment_intents/${pi.id}/cancel`, {});
      } catch (e) {
        console.error("[door-sell] order failed AND PI cancel failed", pi.id, e);
      }
      await supabase
        .from("ticket_holds")
        .update({ status: "released" })
        .eq("payment_intent_id", pi.id)
        .eq("status", "active");
      throw orderError;
    }

    return json({
      ok: true,
      clientSecret: pi.client_secret,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      paymentIntentId: pi.id,
      order_id: orderRow?.id ?? null,
      quote,
    });
  } catch (err: any) {
    console.error("[door-sell] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
}));
