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
import { computeFees, MIN_TIER_PRICE_CENTS } from "../_shared/fee-calculator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    if (!EMAIL_RE.test(guestEmail)) return err("invalid_email", "Enter a valid email.");
    if (!Number.isFinite(eventId) || !ticketTypeId) return err("invalid_request", "Missing event or tier.");

    // Event must be public + selling tickets, not cancelled. Anon never reaches
    // private/spicy events (the visibility resolver hides them).
    const { data: ev } = await supabase
      .from("events")
      .select("id, title, visibility, status, ticketing_enabled, host_id, fee_mode, attendee_name_requirement")
      .eq("id", eventId)
      .single();
    if (!ev || ev.visibility !== "public") return err("event_not_found", "Event not found.", 404);
    if (coalesceStatus(ev.status) === "cancelled") return err("event_cancelled", "This event was cancelled.");

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
        "id, event_id, name, price_cents, is_active, status, sale_start, sale_end, quantity_total, quantity_sold, quantity_held, max_per_user, tier_visibility",
      )
      .eq("id", ticketTypeId)
      .single();
    if (!tier || tier.event_id !== eventId) return err("tier_not_found", "Ticket type not found.", 404);
    if (tier.is_active === false || tier.status === "paused" || tier.status === "ended")
      return err("tier_unavailable", "That ticket isn't on sale.");
    if (tier.price_cents <= 0) return err("not_paid", "This is a free RSVP event.");
    const now = Date.now();
    if (tier.sale_start && new Date(tier.sale_start).getTime() > now)
      return err("not_started", "Sales haven't started yet.");
    if (tier.sale_end && new Date(tier.sale_end).getTime() < now)
      return err("sale_ended", "Sales have ended.");

    // Availability = total − sold − active(unexpired) holds. Mirrors
    // create-payment-intent so guest + authed checkouts share one inventory view
    // and concurrent guests can't oversell during the Stripe redirect window.
    if (tier.quantity_total != null) {
      const { count: activeHolds } = await supabase
        .from("ticket_holds")
        .select("*", { count: "exact", head: true })
        .eq("ticket_type_id", ticketTypeId)
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString());
      const available =
        (tier.quantity_total ?? 0) - (tier.quantity_sold ?? 0) - (activeHolds ?? 0);
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
    const fees = computeFees(subtotal, quantity);
    // fee_mode: 'pass' (default) → buyer pays the buyer-side fee; 'absorb' →
    // organizer eats it (buyer pays just the ticket), but only when the platform
    // fee still fits inside the subtotal (else fall back to pass).
    const absorb = ev.fee_mode === "absorb" && fees.application_fee_amount <= subtotal;

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
      // Destination charge → organizer's connected account; DVNT keeps the fee.
      "payment_intent_data[transfer_data][destination]": organizer.stripe_account_id,
      "payment_intent_data[application_fee_amount]": String(fees.application_fee_amount),
      "payment_intent_data[metadata][type]": "event_ticket",
      "payment_intent_data[metadata][event_id]": String(eventId),
      "payment_intent_data[metadata][ticket_type_id]": ticketTypeId,
      "payment_intent_data[metadata][guest_email]": guestEmail,
      "payment_intent_data[metadata][subtotal_cents]": String(fees.subtotal),
      "payment_intent_data[metadata][buyer_fee_cents]": String(absorb ? 0 : fees.buyer_fee),
      "payment_intent_data[metadata][organizer_fee_cents]": String(fees.organizer_fee),
      "payment_intent_data[metadata][fee_mode]": absorb ? "absorb" : "pass",
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
    await supabase.from("ticket_holds").insert({
      user_id: null,
      ticket_type_id: ticketTypeId,
      event_id: eventId,
      quantity,
      payment_intent_id: session.id,
      status: "active",
      expires_at: new Date(Date.now() + 31 * 60 * 1000).toISOString(),
    });

    return json({ ok: true, url: session.url });
  } catch (e) {
    console.error("[guest-checkout]", e);
    return err("internal_error", "Could not start checkout.", 500);
  }
});

function coalesceStatus(s: unknown): string {
  return typeof s === "string" ? s : "";
}
