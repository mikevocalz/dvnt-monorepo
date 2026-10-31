/**
 * Edge Function: guest-checkout
 *
 * Ticket checkout for a GUEST (no account), including free RSVP tiers when
 * Sell tickets is off. Validates the event/tier/availability + per-email cap,
 * then issues a $0 order directly or creates a hosted Stripe Checkout Session
 * (mode=payment) carrying the same event_ticket metadata the stripe-webhook
 * already issues guest tickets from. Paid buyers use Stripe's page; the webhook
 * issues + emails their ticket(s). No card data touches us, no account required.
 *
 *   POST { event_id, ticket_type_id, quantity, guest_email, guest_name?,
 *          username?, full_name?, phone? }
 *   -> { ok, url }   // redirect the browser to `url`
 *
 * username/full_name/phone: send all three or none. With them, the buyer gets
 * a restricted profile once the ticket is issued (_shared/checkout-profile.ts).
 * Without them the request is an older client and checkout works as before.
 *
 * Deno env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, PUBLIC_SITE_URL.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { priceGuestCheckout, GuestPriceError } from "../_shared/guest-checkout-pricing.ts";
import { checkoutTicketLines } from "../_shared/checkout-line-items.ts";
import { incrementPromoUsage } from "../_shared/apply-promo-code.ts";
import {
  enforceTierVisibility,
  TIER_VISIBILITY_MESSAGES,
} from "../_shared/tier-visibility.ts";
import { isSalesClosed } from "../_shared/sales-cutoff.ts";
import { tierSaleAvailabilityError } from "../_shared/tier-sale-availability.ts";
import { isUnpublished } from "../_shared/event-access.ts";
import { createSignedQrPayload } from "../_shared/hmac-qr.ts";
import { deliverTicketBundleEmail } from "../_shared/ticket-email-delivery.ts";
import { parseCheckoutProfileFields } from "../_shared/checkout-profile-fields.ts";
import {
  provisionCheckoutProfile,
  recordCheckoutProfileIntake,
} from "../_shared/checkout-profile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live").replace(/\/$/, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(code: string, message: string, status = 200): Response {
  return json({ ok: false, error: { code, message } }, status);
}

/** Free orders have no Stripe webhook. Persist the already validated promoter
 * and locked order rates directly to the existing attribution table. Resolving
 * a code again would lose/alter history when the promoter is renamed, paused or
 * edited. ON CONFLICT DO NOTHING keeps replays idempotent. No ledger is written.
 */
async function recordFreePromoterAttribution(supabase: any, order: {
  id: string;
  promoter_id?: unknown;
  promoter_customer_discount_bps?: unknown;
  promoter_commission_bps?: unknown;
  promoter_discount_amount_cents?: unknown;
  promoter_commission_amount_cents?: unknown;
}): Promise<void> {
  const validRate = (value: unknown) => typeof value === "number" &&
    Number.isInteger(value) && value >= 0 && value <= 10000;
  if (typeof order.promoter_id !== "string" || !order.promoter_id ||
      order.promoter_commission_amount_cents !== 0 ||
      !validRate(order.promoter_customer_discount_bps) ||
      !validRate(order.promoter_commission_bps)) return;
  try {
    const { error } = await supabase.from("promoter_attributions").upsert({
      order_id: order.id,
      promoter_id: order.promoter_id,
      locked_rev_share_bps: order.promoter_commission_bps,
      locked_customer_discount_bps: order.promoter_customer_discount_bps,
      locked_promoter_commission_bps: order.promoter_commission_bps,
      locked_promoter_discount_amount_cents: order.promoter_discount_amount_cents ?? null,
      locked_promoter_commission_amount_cents: 0,
    }, { onConflict: "order_id", ignoreDuplicates: true });
    if (error) console.error("[guest-checkout] free-order promoter attribution failed:", error);
  } catch (error) {
    console.error("[guest-checkout] free-order promoter attribution failed:", error);
  }
}


async function stripePost(endpoint: string, body: Record<string, string>): Promise<any> {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("method", "Method not allowed.", 405);
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const envelope = await req.json().catch(() => ({}));
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
      return err("invalid_request", "Invalid checkout request.", 400);
    const isQuote = envelope.action === "quote";
    if (envelope.action != null && !["quote", "checkout"].includes(envelope.action))
      return err("invalid_request", "Unknown checkout action.", 400);
    // A nested quote payload cannot accidentally execute a purchase against an
    // older deployed guest-checkout version that does not understand quotes.
    const body = isQuote ? envelope.quote_request : envelope;
    if (!body || typeof body !== "object" || Array.isArray(body))
      return err("invalid_request", "Invalid checkout request.", 400);
    const eventId = Number(body.event_id);
    const ticketTypeId = String(body.ticket_type_id || "");
    const quantity = Number(body.quantity ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10)
      return err("invalid_quantity", "Choose between 1 and 10 tickets.", 400);
    const guestEmail = String(body.guest_email || "").trim().toLowerCase();
    const guestName = body.guest_name ? String(body.guest_name).trim() : "";
    const attendeeNames: string[] = Array.isArray(body.attendee_names)
      ? body.attendee_names.slice(0, quantity).map((n: unknown) => (n == null ? "" : String(n).trim()))
      : [];
    if ((!isQuote || guestEmail) && (!EMAIL_RE.test(guestEmail) || guestEmail.length > 254))
      return err("invalid_email", "Enter a valid email.");
    const profile = isQuote ? { ok: true as const, fields: null } : parseCheckoutProfileFields(body);
    if (!profile.ok) return err(profile.code, profile.message);
    const profileFields = profile.fields;
    if (!Number.isSafeInteger(eventId) || eventId <= 0 || !ticketTypeId) return err("invalid_request", "Missing event or tier.");

    // Idempotency: the client generates one key per sheet open, so a
    // double-tap or retried submission returns the SAME order+tickets.
    const idempotencyKey =
      typeof body.idempotency_key === "string" &&
      body.idempotency_key.length <= 128 &&
      /^[A-Za-z0-9:_-]+$/.test(body.idempotency_key)
        ? body.idempotency_key
        : null;

    // Replay short-circuit BEFORE any cap/inventory checks: a retried
    // request would otherwise trip max_per_user on the tickets it already
    // minted. Returns the SAME order, never a second issuance.
    if (!isQuote && idempotencyKey) {
      const { data: existing } = await supabase
        .from("orders")
        .select("id, quantity, event_id, guest_email, total_cents, status, promoter_id, promoter_customer_discount_bps, promoter_commission_bps, promoter_discount_amount_cents, promoter_commission_amount_cents")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) {
        if (existing.event_id !== eventId || existing.guest_email !== guestEmail || existing.quantity !== quantity)
          return err("idempotency_conflict", "This checkout attempt belongs to a different selection.", 409);
        if (existing.status !== "paid" || existing.total_cents !== 0)
          return err("checkout_processing", "Your previous checkout is still processing.", 409);
        const { data: existingTickets, error: replayError } = await supabase
          .from("tickets")
          .select("ticket_type_id")
          .eq("order_id", existing.id);
        if (replayError || existingTickets?.length !== existing.quantity)
          return err("checkout_processing", "Your tickets are still being issued. Please retry shortly.", 409);
        if (existingTickets.some((ticket: { ticket_type_id: string }) => ticket.ticket_type_id !== ticketTypeId))
          return err("idempotency_conflict", "This checkout attempt belongs to a different selection.", 409);
        const count = existingTickets.length;
        await recordFreePromoterAttribution(supabase, existing);
        return json({
          ok: true,
          free: true,
          order_id: existing.id,
          count: count ?? existing.quantity ?? quantity,
          idempotent: true,
        });
      }
    }

    // This service-role read bypasses RLS and can be called without the UI.
    // Enforce guest eligibility here before quotes, holds, orders or payments.
    const { data: ev } = await supabase
      .from("events")
      .select("id, title, visibility, status, ticketing_enabled, nsfw, host_id, fee_mode, attendee_name_requirement, end_date, start_date, is_hidden, publish_at")
      .eq("id", eventId)
      .single();
    // A guest has no account, so no relationship can open a hidden or
    // not-yet-published event: it reads as missing, like a private one.
    if (!ev || ev.visibility !== "public" || ev.nsfw === true || isUnpublished(ev)) return err("event_not_found", "Event not found.", 404);
    if (ev.status === "cancelled" || ev.status === "canceled") return err("event_cancelled", "This event was cancelled.");
    if (ev.status !== "active")
      return err("event_unavailable", "Tickets aren't available for this event.", 409);
    // Card-not-present sales stop 30 min before the event ends — after
    // that the only legitimate way to sell is card-present (Tap to Pay).
    if (isSalesClosed(ev)) return err("sales_closed", "Ticket sales have ended for this event.");

    // Attendee-name requirement (Eventbrite parity) — enforced before payment.
    if (!isQuote && ev.attendee_name_requirement === "required") {
      for (let i = 0; i < quantity; i++) {
        if (!attendeeNames[i]) return err("name_required", "A name is required for each ticket.");
      }
    }

    // Tier must belong to the event, be on sale, and have inventory.
    const { data: tier } = await supabase
      .from("ticket_types")
      .select(
        "id, event_id, name, price_cents, is_active, is_sold_out, status, sale_start, sale_end, quantity_total, quantity_sold, quantity_held, max_per_user, max_per_order, tier_visibility, unlock_code, unlocks_after_tier_id",
      )
      .eq("id", ticketTypeId)
      .single();
    if (!tier || tier.event_id !== eventId) return err("tier_not_found", "Ticket type not found.", 404);
    // Sell tickets controls PAID sales, not free RSVP admission. Only a
    // server-priced $0 tier may use a non-ticketed event; discounts must never
    // reopen a disabled paid tier. Unknown flags/prices still fail closed.
    if (ev.ticketing_enabled !== true &&
        !(ev.ticketing_enabled === false && tier.price_cents === 0))
      return err("event_unavailable", "Tickets aren't available for this event.", 409);

    // Tier visibility guard (mirror of cart_create_hold v3) — this rail
    // inserts ticket_holds directly, bypassing the RPC's hidden/locked
    // enforcement. hidden → never purchasable; locked → requires a valid
    // unlock code (or the gating tier being sold out). Never echo the code.
    const visibilityError = await enforceTierVisibility(
      supabase,
      tier,
      body.unlock_code,
    );
    if (visibilityError) {
      return err(
        visibilityError,
        TIER_VISIBILITY_MESSAGES[visibilityError],
        visibilityError === "tier_hidden" ? 404 : 403,
      );
    }
    if (tier.max_per_order > 0 && quantity > tier.max_per_order) {
      return err("order_limit", `Limit ${tier.max_per_order} per order for this ticket.`, 400);
    }
    // The quote and both paid/free checkout use the same online sale policy.
    // Keep visibility first so unavailable tiers cannot disclose hidden state.
    const saleError = tierSaleAvailabilityError(tier);
    if (saleError) return err(saleError.code, saleError.error);

    // Advisory pre-check only — fails an obviously sold-out tier before we
    // create a Stripe session. The binding check is ticket_purchase_hold_atomic
    // below, which locks the tier and counts BOTH hold tables by seat. The
    // count-based arithmetic that used to live here counted hold ROWS (a hold
    // for 5 seats counted as 1) and never saw cart_holds at all.
    if (tier.quantity_total != null) {
      const available =
        (tier.quantity_total ?? 0) - (tier.quantity_sold ?? 0);
      if (available < quantity) return err("sold_out", `Only ${Math.max(0, available)} left.`);
    }

    // Per-email cap (the posh.vip pattern — guests are NOT unlimited).
    if (guestEmail && tier.max_per_user && tier.max_per_user > 0) {
      const { count, error: ownedError } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("ticket_type_id", ticketTypeId)
        .eq("guest_email", guestEmail)
        .in("status", ["active", "scanned", "transfer_pending"]);
      if (ownedError) throw ownedError;
      if ((count ?? 0) + quantity > tier.max_per_user)
        return err("limit", `Limit ${tier.max_per_user} per person for this ticket.`);
    }

    // The quote is read-only. The charge recomputes this same server pricing,
    // including code validity, buyer caps, and the exact current fee mode.
    const pricing = await priceGuestCheckout(supabase, {
      eventId, tierId: ticketTypeId, unitPriceCents: tier.price_cents, quantity,
      feeMode: ev.fee_mode, guestEmail, discountCode: body.discount_code,
      promoCode: body.promo_code, promoterCode: body.promoter_code,
    });
    if (isQuote) return json({ ok: true, quote: pricing.quote });
    if ((body.discount_code || body.promo_code) && !body.expected_quote_key)
      return err("quote_required", "Apply your code and review the total before paying.", 409);
    if (body.expected_quote_key && body.expected_quote_key !== pricing.quote.quote_key)
      return err("quote_changed", "Your ticket price or discount changed. Review the updated total before paying.", 409);

    // Free issuance is a single database transaction. The RPC holds the tier
    // lock until order + tickets + sold count + hold conversion all commit;
    // there is no gap where an issued seat becomes available again.
    if (pricing.quote.total_cents === 0) {
      const ticketRows = [];
      for (let i = 0; i < quantity; i++) {
        const ticketUuid = crypto.randomUUID();
        const { qrToken, qrPayload } = await createSignedQrPayload(
          ticketUuid,
          eventId,
        );
        ticketRows.push({
          id: ticketUuid,
          event_id: eventId,
          ticket_type_id: ticketTypeId,
          user_id: null,
          guest_email: guestEmail,
          guest_name: guestName || null,
          attendee_name: attendeeNames[i] || guestName || null,
          guest_lookup_token: crypto.randomUUID(),
          status: "active",
          qr_token: qrToken,
          qr_payload: qrPayload,
          purchase_amount_cents: 0,
          order_index: i + 1,
          order_count: quantity,
        });
      }

      const { data: issued, error: issueError } = await supabase.rpc(
        "guest_free_checkout_atomic",
        {
          p_ticket_type_id: ticketTypeId,
          p_ticket_rows: ticketRows,
          p_order: {
            guest_email: guestEmail,
            quantity,
            subtotal_cents: 0,
            total_cents: 0,
            event_id: eventId,
            expected_unit_price_cents: tier.price_cents,
            ...pricing.orderFields,
            ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
          },
        },
      );
      if (issueError || !issued?.ok) {
        const code = issued?.error;
        if (code === "insufficient_inventory")
          return err("sold_out", typeof issued.available === "number" && issued.available > 0
            ? `Only ${issued.available} left.` : "Those tickets just sold out.", 409);
        if (code === "order_limit") return err("order_limit", `Limit ${issued.limit} per order for this ticket.`, 409);
        if (code === "limit" || code === "buyer_limit") return err("limit", `Limit ${issued.limit} per person for this ticket.`, 409);
        if (code === "idempotency_conflict")
          return err(code, "This checkout attempt belongs to a different selection.", 409);
        if (code === "checkout_processing" || issueError?.code === "23505")
          return err("checkout_processing", "Your previous checkout is still processing. Please retry shortly.", 409);
        if (code === "quote_changed")
          return err(code, "Your ticket price or discount changed. Review the updated total before paying.", 409);
        if (code === "tier_not_found" || code === "tier_unavailable")
          return err("tier_unavailable", "That ticket isn't on sale.", 409);
        console.error("[guest-checkout] atomic free issuance failed:", issueError || issued);
        return err("internal_error", "Could not issue your ticket.", 500);
      }
      const freeOrder = { id: issued.order_id };
      // A simultaneous same-key request may have committed while this request
      // prepared its QR rows. Only the winning transaction runs side effects.
      if (issued.idempotent) {
        await recordFreePromoterAttribution(supabase, issued.order);
        return json({ ok: true, free: true, order_id: freeOrder.id, count: issued.count, idempotent: true });
      }

      // Count a promo only after the ticket insert succeeds, never on quote,
      // abandoned checkout, or the existing idempotent replay path.
      if (pricing.promo) await incrementPromoUsage(supabase, pricing.promo.promo_code_id);
      await recordFreePromoterAttribution(supabase, {
        id: freeOrder.id,
        ...pricing.orderFields,
      });

      // Profile before email, so the email can name the account it made.
      // Best-effort: a failure here never touches the issued tickets.
      const created = profileFields
        ? await provisionCheckoutProfile(supabase, profileFields, "[guest-checkout]")
        : null;

      // Bundle email from the order's authoritative rows. Failure is
      // persisted as retryable delivery state — never a rollback of
      // issued tickets.
      await deliverTicketBundleEmail(supabase, freeOrder.id, {
        kind: "fulfillment",
        logPrefix: "[guest-checkout]",
        profileUsername: created?.status === "created" ? created.username : null,
      });

      return json({
        ok: true,
        free: true,
        order_id: freeOrder.id,
        count: quantity,
      });
    }

    // Free RSVPs need neither Stripe configuration nor organizer onboarding.
    if (!STRIPE_SECRET_KEY) return err("config", "Payments are not configured.", 500);

    // Organizer must be onboarded to Stripe Connect — the charge is a
    // destination charge to their account (same as the authed flow); otherwise
    // a guest purchase wouldn't pay the organizer.
    const { data: organizer } = await supabase
      .from("organizer_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("host_id", ev.host_id)
      .single();
    if (!organizer?.stripe_account_id || !organizer?.charges_enabled) {
      return err("organizer_payouts", "This organizer hasn't finished payment setup yet.");
    }

    const fees = pricing.fees!;
    const absorb = fees.fee_mode === "absorb";
    const ticketLines = checkoutTicketLines(fees.subtotal, quantity, "usd", `${ev.title} — ${tier.name}`);
    const feeLine = ticketLines.count;
    const discountMetadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(pricing.metadata)) {
      discountMetadata[`metadata[${key}]`] = value;
      discountMetadata[`payment_intent_data[metadata][${key}]`] = value;
    }

    // Hosted Checkout Session. Metadata mirrors what stripe-webhook reads for
    // guest event_ticket issuance (user_id omitted → treated as a guest).
    const params: Record<string, string> = {
      mode: "payment",
      "payment_method_types[0]": "card",
      customer_email: guestEmail,
      ...ticketLines.params,
      ...discountMetadata,
      // Expire the session in 30min (Stripe min) so an abandoned checkout's hold
      // can be released without leaking inventory.
      expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
      success_url: `${SITE_URL}/checkout/success?email=${encodeURIComponent(guestEmail)}`,
      cancel_url: `${SITE_URL}/events`,
      "metadata[type]": "event_ticket",
      "metadata[event_id]": String(eventId),
      "metadata[ticket_type_id]": ticketTypeId,
      "metadata[quantity]": String(quantity),
      "metadata[guest_email]": guestEmail,
      "metadata[guest_name]": guestName,
      // Per-ticket names → the webhook stamps attendee_name + "Ticket N of M".
      ...(attendeeNames.some((n) => n)
        ? { "metadata[attendee_names]": JSON.stringify(attendeeNames) }
        : {}),
      // Destination charge → organizer's connected account; DVNT keeps the fee.
      "payment_intent_data[transfer_data][destination]": organizer.stripe_account_id,
      "payment_intent_data[application_fee_amount]": String(fees.application_fee_amount),
      "payment_intent_data[metadata][type]": "event_ticket",
      "payment_intent_data[metadata][event_id]": String(eventId),
      "payment_intent_data[metadata][ticket_type_id]": ticketTypeId,
      "payment_intent_data[metadata][guest_email]": guestEmail,
      "payment_intent_data[metadata][subtotal_cents]": String(fees.subtotal),
      // buyer_fee is the EFFECTIVE fee (already 0 in absorb mode).
      "payment_intent_data[metadata][buyer_fee_cents]": String(fees.buyer_fee),
      "payment_intent_data[metadata][organizer_fee_cents]": String(fees.organizer_fee),
      "payment_intent_data[metadata][fee_mode]": fees.fee_mode,
    };
    // In pass mode the buyer covers the buyer-side fee as a second line item;
    // in absorb mode there's no extra line (they pay just the ticket).
    if (!absorb) {
      params[`line_items[${feeLine}][price_data][currency]`] = "usd";
      params[`line_items[${feeLine}][price_data][unit_amount]`] = String(fees.buyer_fee);
      params[`line_items[${feeLine}][price_data][product_data][name]`] = "Service fee";
      params[`line_items[${feeLine}][quantity]`] = "1";
    }
    const session = await stripePost("/checkout/sessions", params);

    // Reserve inventory for the redirect window. The stripe-webhook converts
    // this hold (status → converted) by payment_intent_id = session.id on
    // payment; if abandoned, it just expires (the availability count ignores
    // expired holds). Keyed to the Checkout Session id like the webhook expects.
    // Atomic hold — see create-payment-intent for the full rationale. 31 min
    // covers the hosted-Checkout redirect window.
    const { data: guestHold, error: guestHoldErr } = await supabase.rpc(
      "ticket_purchase_hold_atomic",
      {
        p_ticket_type_id: ticketTypeId,
        p_quantity: quantity,
        p_payment_intent_id: session.id,
        p_guest_email: guestEmail,
        p_hold_seconds: 31 * 60,
      },
    );

    if (guestHoldErr || !guestHold?.ok) {
      // Expire the hosted session so the guest cannot pay for inventory that
      // is no longer theirs.
      try {
        await stripePost(`/checkout/sessions/${session.id}/expire`, {});
      } catch (e) {
        console.error(
          "[guest-checkout] hold failed AND session expire failed",
          session.id,
          e,
        );
      }
      if (guestHold?.error === "buyer_limit") {
        return err("limit", `Limit ${guestHold.limit} per person for this ticket, including pending checkouts.`, 409);
      }
      const available = guestHold?.available;
      return err(
        "sold_out",
        typeof available === "number" && available > 0
          ? `Only ${available} left.`
          : "Those tickets just sold out.",
      );
    }

    // Create the order row in payment_pending, keyed to the Checkout
    // Session — mirrors ticket-checkout. Previously this rail created no
    // order until reconciliation, which meant the webhook's
    // orders-by-session lookup (status flip + promoter attribution) had
    // nothing to attach to. Fee columns are server-truth from computeFees;
    // in absorb mode the buyer-side fee is zeroed (organizer eats it) and
    // total is just the subtotal.
    const { error: guestOrderError } = await supabase.from("orders").insert({
      user_id: null,
      guest_email: guestEmail,
      type: "event_ticket",
      status: "payment_pending",
      quantity,
      subtotal_cents: fees.subtotal,
      platform_fee_cents: fees.dvnt_total_fee,
      // Moded breakdown: customer_charge == subtotal and buyer_* == 0 in
      // absorb mode, so the columns can be written straight through.
      total_cents: fees.customer_charge_amount,
      buyer_pct_fee_cents: fees.buyer_pct_fee,
      buyer_per_ticket_fee_cents: fees.buyer_per_ticket_fee,
      buyer_fee_cents: fees.buyer_fee,
      org_pct_fee_cents: fees.org_pct_fee,
      org_per_ticket_fee_cents: fees.org_per_ticket_fee,
      organizer_fee_cents: fees.organizer_fee,
      dvnt_total_fee_cents: fees.dvnt_total_fee,
      fee_policy_version: fees.fee_policy_version,
      event_id: eventId,
      stripe_checkout_session_id: session.id,
      ...pricing.orderFields,
    });
    if (guestOrderError) {
      // Non-fatal: the Stripe session is already live. Log loudly —
      // reconciliation can still repair the order later.
      console.error("[guest-checkout] order insert failed:", guestOrderError);
    }

    // The profile is made when the webhook issues the tickets, not now: an
    // abandoned checkout must not leave an account (or a claimed username)
    // behind. The fields wait under the session id until then.
    if (profileFields) {
      await recordCheckoutProfileIntake(supabase, session.id, profileFields, "[guest-checkout]");
    }

    return json({ ok: true, url: session.url });
  } catch (e) {
    if (e instanceof GuestPriceError) return err("invalid_discount", e.message, 400);
    console.error("[guest-checkout]", e);
    return err("internal_error", "Could not start checkout.", 500);
  }
});
