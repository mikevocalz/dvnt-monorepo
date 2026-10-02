/**
 * Edge Function: guest-checkout
 *
 * Paid ticket purchase for a GUEST (no account) — the paid sibling of the RSVP
 * flow. Validates the event/tier/availability + per-email cap, then creates a
 * hosted Stripe Checkout Session (mode=payment) carrying the same event_ticket
 * metadata the stripe-webhook already issues guest tickets from. The buyer pays
 * on Stripe's page; the webhook issues + emails the ticket(s). No card data ever
 * touches us, no account required.
 *
 *   POST { event_id, ticket_type_id, quantity, guest_email, guest_name? }
 *   -> { ok, url }   // redirect the browser to `url`
 *
 * Deno env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, PUBLIC_SITE_URL.
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
import { isSalesClosed } from "../_shared/sales-cutoff.ts";
import { createSignedQrPayload } from "../_shared/hmac-qr.ts";
import { deliverTicketBundleEmail } from "../_shared/ticket-email-delivery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  try {
    if (!STRIPE_SECRET_KEY) return err("config", "Payments are not configured.", 500);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const eventId = Number(body.event_id);
    const ticketTypeId = String(body.ticket_type_id || "");
    const quantity = Math.max(1, Math.min(10, Number(body.quantity) || 1));
    const guestEmail = String(body.guest_email || "").trim().toLowerCase();
    const guestName = body.guest_name ? String(body.guest_name).trim() : "";
    const attendeeNames: string[] = Array.isArray(body.attendee_names)
      ? body.attendee_names.slice(0, quantity).map((n: unknown) => (n == null ? "" : String(n).trim()))
      : [];
    // Promoter attribution code (WS-4) — from a tracked ?ref= link or
    // manual entry. Never touches pricing; stashed in Stripe metadata so
    // stripe-webhook can record attribution + rev-share when paid.
    const promoterCodeRaw =
      typeof body.promoter_code === "string"
        ? body.promoter_code.trim().toUpperCase().slice(0, 32)
        : "";
    const promoterCode = /^[A-Z0-9_-]{2,32}$/.test(promoterCodeRaw)
      ? promoterCodeRaw
      : "";

    if (!EMAIL_RE.test(guestEmail)) return err("invalid_email", "Enter a valid email.");
    if (!Number.isFinite(eventId) || !ticketTypeId) return err("invalid_request", "Missing event or tier.");

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
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from("orders")
        .select("id, quantity")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) {
        const { count } = await supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("order_id", existing.id);
        return json({
          ok: true,
          free: true,
          order_id: existing.id,
          count: count ?? existing.quantity ?? quantity,
          idempotent: true,
        });
      }
    }

    // Event must be public + selling tickets, not cancelled. Anon never reaches
    // private/spicy events (the visibility resolver hides them).
    const { data: ev } = await supabase
      .from("events")
      .select("id, title, visibility, status, ticketing_enabled, host_id, fee_mode, attendee_name_requirement, end_date, start_date")
      .eq("id", eventId)
      .single();
    if (!ev || ev.visibility !== "public") return err("event_not_found", "Event not found.", 404);
    if (coalesceStatus(ev.status) === "cancelled") return err("event_cancelled", "This event was cancelled.");
    // Card-not-present sales stop 30 min before the event ends — after
    // that the only legitimate way to sell is card-present (Tap to Pay).
    if (isSalesClosed(ev)) return err("sales_closed", "Ticket sales have ended for this event.");

    // Attendee-name requirement (Eventbrite parity) — enforced before payment.
    if (ev.attendee_name_requirement === "required") {
      for (let i = 0; i < quantity; i++) {
        if (!attendeeNames[i]) return err("name_required", "A name is required for each ticket.");
      }
    }

    // Tier must belong to the event, be on sale, and have inventory.
    const { data: tier } = await supabase
      .from("ticket_types")
      .select(
        "id, event_id, name, price_cents, is_active, status, sale_start, sale_end, quantity_total, quantity_sold, quantity_held, max_per_user, tier_visibility, unlock_code, unlocks_after_tier_id",
      )
      .eq("id", ticketTypeId)
      .single();
    if (!tier || tier.event_id !== eventId) return err("tier_not_found", "Ticket type not found.", 404);
    if (tier.is_active === false || tier.status === "paused" || tier.status === "ended")
      return err("tier_unavailable", "That ticket isn't on sale.");

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
    const now = Date.now();
    if (tier.sale_start && new Date(tier.sale_start).getTime() > now)
      return err("not_started", "Sales haven't started yet.");
    if (tier.sale_end && new Date(tier.sale_end).getTime() < now)
      return err("sale_ended", "Sales have ended.");

    // Advisory pre-check only — fails an obviously sold-out tier before we
    // create a Stripe session. The binding check is ticket_hold_create_atomic
    // below, which locks the tier and counts BOTH hold tables by seat. The
    // count-based arithmetic that used to live here counted hold ROWS (a hold
    // for 5 seats counted as 1) and never saw cart_holds at all.
    if (tier.quantity_total != null) {
      const available =
        (tier.quantity_total ?? 0) - (tier.quantity_sold ?? 0);
      if (available < quantity) return err("sold_out", `Only ${Math.max(0, available)} left.`);
    }

    // Per-email cap (the posh.vip pattern — guests are NOT unlimited).
    if (tier.max_per_user && tier.max_per_user > 0) {
      const { count } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("ticket_type_id", ticketTypeId)
        .eq("guest_email", guestEmail)
        .eq("status", "active");
      if ((count ?? 0) + quantity > tier.max_per_user)
        return err("limit", `Limit ${tier.max_per_user} per person for this ticket.`);
    }

    // ── Free tier on a ticketed event — issue directly, no Stripe ─────
    // A $0 tier is still real inventory: capacity is serialized by the
    // same atomic hold the paid rails use (counts live ticket_holds +
    // cart_holds), converted to sold on success, released on failure.
    // The guest gets the standard ticket-bundle email — the QR + lookup
    // link is the whole delivery contract for account-less buyers.
    if (tier.price_cents <= 0) {
      const { data: freeHold, error: freeHoldErr } = await supabase.rpc(
        "ticket_hold_create_atomic",
        {
          p_ticket_type_id: ticketTypeId,
          p_quantity: quantity,
          p_guest_email: guestEmail,
          p_hold_seconds: 600,
        },
      );
      if (freeHoldErr || !freeHold?.ok) {
        const available = freeHold?.available;
        return err(
          "sold_out",
          typeof available === "number" && available > 0
            ? `Only ${available} left.`
            : "Those tickets just sold out.",
          409,
        );
      }

      // Order first so every ticket stamps the authoritative order_id.
      const { data: freeOrder, error: freeOrderErr } = await supabase
        .from("orders")
        .insert({
          user_id: null,
          guest_email: guestEmail,
          type: "event_ticket",
          status: "paid",
          quantity,
          subtotal_cents: 0,
          total_cents: 0,
          event_id: eventId,
          paid_at: new Date().toISOString(),
          currency: "usd",
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        })
        .select("id")
        .single();
      if (freeOrderErr || !freeOrder?.id) {
        await supabase
          .from("ticket_holds")
          .update({ status: "released" })
          .eq("id", freeHold.holdId);
        // Lost the same-key race → the winner's order is the answer.
        if (freeOrderErr?.code === "23505" && idempotencyKey) {
          const { data: won } = await supabase
            .from("orders")
            .select("id, quantity")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (won) {
            const { count } = await supabase
              .from("tickets")
              .select("id", { count: "exact", head: true })
              .eq("order_id", won.id);
            return json({
              ok: true,
              free: true,
              order_id: won.id,
              count: count ?? won.quantity ?? quantity,
              idempotent: true,
            });
          }
        }
        console.error("[guest-checkout] free order insert failed:", freeOrderErr);
        return err("internal_error", "Could not issue your ticket.", 500);
      }

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
          order_id: freeOrder.id,
          order_index: i + 1,
          order_count: quantity,
        });
      }
      const { error: ticketErr } = await supabase
        .from("tickets")
        .insert(ticketRows);
      if (ticketErr) {
        // Roll back: release the hold and drop the orphaned order so a
        // retry starts clean rather than stranding a paid-status $0 order.
        await supabase
          .from("ticket_holds")
          .update({ status: "released" })
          .eq("id", freeHold.holdId);
        await supabase.from("orders").delete().eq("id", freeOrder.id);
        console.error("[guest-checkout] free ticket insert failed:", ticketErr);
        return err("internal_error", "Could not issue your ticket.", 500);
      }

      await supabase
        .from("ticket_holds")
        .update({ status: "converted" })
        .eq("id", freeHold.holdId);
      await supabase
        .from("ticket_types")
        .update({ quantity_sold: (tier.quantity_sold || 0) + quantity })
        .eq("id", ticketTypeId);
      await supabase.from("order_timeline").insert([
        { order_id: freeOrder.id, type: "created", label: "Order created" },
        {
          order_id: freeOrder.id,
          type: "payment_captured",
          label: "Free guest ticket issued",
        },
      ]);

      // Bundle email from the order's authoritative rows. Failure is
      // persisted as retryable delivery state — never a rollback of
      // issued tickets.
      await deliverTicketBundleEmail(supabase, freeOrder.id, {
        kind: "fulfillment",
        logPrefix: "[guest-checkout]",
      });

      return json({
        ok: true,
        free: true,
        order_id: freeOrder.id,
        count: quantity,
      });
    }

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

    // Fees (v1_250_1pt), identical math to create-payment-intent.
    const subtotal = tier.price_cents * quantity;
    if (tier.price_cents < MIN_TIER_PRICE_CENTS) {
      return err("price_too_low", "This ticket is priced below the $2.00 minimum for fees.");
    }
    // fee_mode: 'pass' (default) → buyer pays the buyer-side fee; 'absorb' →
    // organizer eats it (buyer pays just the ticket), with automatic fallback
    // to pass when the platform fee doesn't fit inside the subtotal. Shared
    // entry point — same branch on every rail.
    const fees = computeFeesWithMode(subtotal, quantity, ev.fee_mode);
    const absorb = fees.fee_mode === "absorb";

    // Hosted Checkout Session. Metadata mirrors what stripe-webhook reads for
    // guest event_ticket issuance (user_id omitted → treated as a guest).
    const params: Record<string, string> = {
      mode: "payment",
      "payment_method_types[0]": "card",
      customer_email: guestEmail,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(tier.price_cents),
      "line_items[0][price_data][product_data][name]": `${ev.title} — ${tier.name}`,
      "line_items[0][quantity]": String(quantity),
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
      // Promoter attribution — house dvnt_* metadata key (session +
      // PI copies, mirroring the fee metadata duplication below).
      ...(promoterCode
        ? {
            "metadata[dvnt_promoter_code]": promoterCode,
            "payment_intent_data[metadata][dvnt_promoter_code]": promoterCode,
          }
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
      params["line_items[1][price_data][currency]"] = "usd";
      params["line_items[1][price_data][unit_amount]"] = String(fees.buyer_fee);
      params["line_items[1][price_data][product_data][name]"] = "Service fee";
      params["line_items[1][quantity]"] = "1";
    }
    const session = await stripePost("/checkout/sessions", params);

    // Reserve inventory for the redirect window. The stripe-webhook converts
    // this hold (status → converted) by payment_intent_id = session.id on
    // payment; if abandoned, it just expires (the availability count ignores
    // expired holds). Keyed to the Checkout Session id like the webhook expects.
    // Atomic hold — see create-payment-intent for the full rationale. 31 min
    // covers the hosted-Checkout redirect window.
    const { data: guestHold, error: guestHoldErr } = await supabase.rpc(
      "ticket_hold_create_atomic",
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
    });
    if (guestOrderError) {
      // Non-fatal: the Stripe session is already live. Log loudly —
      // reconciliation can still repair the order later.
      console.error("[guest-checkout] order insert failed:", guestOrderError);
    }

    return json({ ok: true, url: session.url });
  } catch (e) {
    console.error("[guest-checkout]", e);
    return err("internal_error", "Could not start checkout.", 500);
  }
});

function coalesceStatus(s: unknown): string {
  return typeof s === "string" ? s : "";
}
