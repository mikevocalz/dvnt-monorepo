/**
 * Buyer-Initiated Ticket Refund
 *
 * POST /ticket-refund
 * Body: { ticket_id, action?: 'refund' | 'cancel_free' }
 *
 * Rules:
 * - Must be the ticket owner.
 * - Ticket must be status = 'active' (not already scanned/refunded/void).
 * - Event must not have started yet (start_date > now()).
 * - Exact-zero tickets use explicit cancel_free and an atomic cancellation RPC.
 *   A missing purchase amount is never inferred to be a free ticket.
 * - Paid tickets: issues Stripe refund for the payment_intent on the ticket.
 *   The stripe-webhook handles the full state sync on `charge.refunded`, but
 *   we also immediately set status = 'refunded' so the UI reflects it fast.
 * - Decrements ticket_types.quantity_sold and events.total_attendees.
 * - Note: if multiple tickets share one payment_intent (qty > 1 purchase),
 *   only THIS ticket is refunded (partial refund). Stripe supports this.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { withSentry } from "../_shared/sentry.ts";
import { getTicketSelfServiceAction } from "../_shared/ticket-self-service.ts";
import { voidWalletPass } from "../_shared/wallet-push.ts";
import { notifyNextWaitlister } from "../_shared/notify-waitlisters.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
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

async function stripeRefund(params: Record<string, string>): Promise<any> {
  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  return res.json();
}

Deno.serve(withSentry("ticket-refund", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return json({ error: "Unauthorized" }, 401);

    let body: any;
    try { body = await req.json(); } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const { ticket_id, action = "refund" } = body ?? {};
    if (typeof ticket_id !== "string" || !ticket_id.trim()) {
      return json({ error: "ticket_id is required" }, 400);
    }
    if (action !== "refund" && action !== "cancel_free") {
      return json({ error: "Invalid ticket action" }, 400);
    }

    // Fetch ticket with event info
    const { data: ticket, error: ticketErr } = await supabase
      .from("tickets")
      .select("id, event_id, user_id, status, purchase_amount_cents, stripe_payment_intent_id, ticket_type_id, checked_in_at, transferred_from, order_id, cart_id, cart_line_item_id")
      .eq("id", ticket_id)
      .single();

    if (ticketErr || !ticket) return json({ error: "Ticket not found" }, 404);
    if (String(ticket.user_id) !== String(authId)) {
      return json({ error: "Not your ticket" }, 403);
    }

    if (action === "cancel_free") {
      const { data: event, error: eventError } = await supabase.from("events")
        .select("start_date, refund_policy, refund_days_before, title")
        .eq("id", ticket.event_id).maybeSingle();
      if (eventError) return json({ error: "Could not verify cancellation eligibility" }, 503);
      let order = null;
      if (ticket.order_id) {
        const result = await supabase.from("orders")
          .select("id, event_id, user_id, status, total_cents, cart_id")
          .eq("id", ticket.order_id).maybeSingle();
        if (result.error) return json({ error: "Could not verify cancellation eligibility" }, 503);
        order = result.data;
      }
      // A repeated cancel is safe: the RPC checks the persisted void state and
      // returns changed=false, never releasing inventory/notifications twice.
      // A completed cancellation remains retryable after the cutoff or a
      // policy change. For void rows the RPC rechecks ownership/price/order
      // and returns its persisted no-op before consulting today's window.
      const replay = ticket.status === "void" && ticket.purchase_amount_cents === 0;
      if (!replay && getTicketSelfServiceAction({ ticket, event, order, userId: authId }) !== "cancel_free") {
        return json({ error: "This ticket cannot be cancelled with free ticket self-service." }, 409);
      }
      const { data: cancelled, error: cancelError } = await supabase.rpc("cancel_free_ticket", {
        p_ticket_id: ticket_id, p_user_id: authId,
      });
      if (cancelError) {
        console.error("[ticket-refund] atomic cancellation failed:", cancelError);
        // No REST fallback: the migration must be available before this action
        // is deployed. A failed transaction must never report success.
        return json({ error: "Cancellation is temporarily unavailable. Please try again." }, 503);
      }
      if (!cancelled?.ok) {
        return json({ error: "This ticket can no longer be cancelled." }, 409);
      }
      if (cancelled.changed === true) {
        // Durable ticket/RSVP/inventory/Wallet state has already committed.
        // Post-commit notification failures must not turn success into a retry.
        try { await voidWalletPass(supabase, ticket_id); } catch (error) {
          console.warn("[ticket-refund] Wallet notification failed:", error);
        }
        try {
          await notifyNextWaitlister(supabase, {
            eventId: cancelled.event_id, ticketTypeId: cancelled.ticket_type_id,
            eventTitle: event?.title ?? null,
          });
        } catch (error) {
          console.warn("[ticket-refund] Waitlist notification failed:", error);
        }
      }
      return json({ ok: true, ticket_id, action: "cancel_free", stripe_refund_id: null,
        already_cancelled: cancelled.changed !== true, message: "Free ticket cancelled successfully" });
    }

    // Legacy requests default to monetary refund, never silent free-ticket
    // cancellation. Null/invalid prices are unknown, not a zero-dollar refund.
    if (!Number.isSafeInteger(ticket.purchase_amount_cents) || ticket.purchase_amount_cents <= 0) {
      return json({ error: ticket.purchase_amount_cents === 0
        ? "Free tickets must be cancelled, not refunded."
        : "This ticket's payment could not be verified. Contact the organizer." }, 409);
    }
    if (ticket.transferred_from != null || ticket.cart_line_item_id || ticket.cart_id) {
      return json({ error: "This ticket is not eligible for an individual buyer refund." }, 409);
    }
    if (ticket.order_id) {
      const { data: order, error: orderError } = await supabase.from("orders")
        .select("id, event_id, user_id, status, cart_id")
        .eq("id", ticket.order_id).maybeSingle();
      if (orderError) return json({ error: "Could not verify the original ticket purchase." }, 503);
      if (!order || order.user_id !== authId || order.event_id !== ticket.event_id ||
          order.cart_id || !["paid", "partially_refunded"].includes(order.status)) {
        return json({ error: "Only the original buyer can refund this ticket." }, 409);
      }
    }
    if (!STRIPE_SECRET_KEY) {
      return json({ error: "Stripe is not configured for this environment. Contact support." }, 503);
    }
    if (ticket.status !== "active") {
      return json({ error: "Only active tickets can be refunded" }, 400);
    }
    if (ticket.checked_in_at) {
      return json({ error: "Checked-in tickets cannot be refunded" }, 400);
    }

    // Enforce the organizer's refund policy (Phase 5 refund engine).
    //   none         → no self-service refunds
    //   before_event → until the event starts (legacy default)
    //   days_before  → until N days before the event
    //   always       → anytime
    const { data: event } = await supabase
      .from("events")
      .select("start_date, refund_policy, refund_days_before")
      .eq("id", ticket.event_id)
      .single();

    const policy = (event?.refund_policy as string) ?? "before_event";
    const start = event?.start_date ? new Date(event.start_date) : null;
    const now = new Date();

    if (policy === "none") {
      return json({ error: "This event doesn't offer refunds." }, 400);
    }
    if (policy === "before_event" && start && start <= now) {
      return json({ error: "Event has already started — refunds are closed." }, 400);
    }
    if (policy === "days_before" && start) {
      const days = Number(event?.refund_days_before ?? 0);
      const deadline = new Date(start.getTime() - days * 86_400_000);
      if (now > deadline) {
        return json(
          { error: `Refunds close ${days} day(s) before the event.` },
          400,
        );
      }
    }
    // policy === "always" → no time gate.

    // Money first, status second. This used to write status='void' BEFORE
    // calling Stripe, which broke two things at once: charge.refunded filters
    // on status='active', so the webhook then matched nothing (no wallet void,
    // no waitlist promotion, ticket stuck 'void' instead of 'refunded'), and a
    // paid ticket with no PaymentIntent was voided with no refund at all while
    // the response said "cancelled successfully".
    // Only an explicitly positive amount reaches this monetary path.
    const paidCents = ticket.purchase_amount_cents;
    const isPaid = paidCents > 0;

    if (isPaid && !ticket.stripe_payment_intent_id) {
      // Refuse rather than hand back a voided ticket and no money.
      return json(
        {
          error:
            "This ticket can't be refunded automatically. Contact the organizer.",
        },
        409,
      );
    }

    let stripeRefundId: string | null = null;
    if (isPaid) {
      const refund = await stripeRefund({
        payment_intent: ticket.stripe_payment_intent_id,
        amount: String(paidCents),
        reason: "requested_by_customer",
        // Destination charge: without these the platform eats the refund and
        // the organizer keeps their transfer. Every other refund path in this
        // repo sets both (bulk-refund-tickets, organizer-refund, event-cancel).
        refund_application_fee: "true",
        reverse_transfer: "true",
        "metadata[ticket_id]": String(ticket_id),
        "metadata[refund_initiator]": "buyer",
      });
      if (refund.error) {
        // Nothing to roll back — status was never touched.
        return json({ error: `Stripe refund failed: ${refund.error.message}` }, 502);
      }
      stripeRefundId = refund.id;
    }

    // Paid: charge.refunded carries metadata[ticket_id], so the webhook flips
    // active → refunded for THIS ticket and handles the wallet pass + waitlist.
    // Write it here too so the UI is right even if the webhook is slow; the
    // webhook's .eq("status","active") makes the second write a no-op.
    // Free cancellation returned above and never enters this refund path.
    await supabase
      .from("tickets")
      .update({ status: isPaid ? "refunded" : "void" })
      .eq("id", ticket_id)
      .eq("status", "active");

    // Decrement quantity_sold on ticket_type. Best-effort — the trigger
    // handles total_attendees. (The builder is thenable but has no .catch,
    // so the old `.catch(() => {})` was a type error, not a guard.)
    // supabase.rpc() resolves with { error } rather than throwing, so a
    // missing/failed RPC lands in `error`, not the catch. Check it.
    const { error: decrementError } = await supabase.rpc(
      "decrement_ticket_quantity_sold",
      { p_ticket_type_id: ticket.ticket_type_id },
    );
    if (decrementError) {
      console.warn(
        "[ticket-refund] decrement failed (non-fatal):",
        decrementError,
      );
    }

    return json({
      ok: true,
      ticket_id,
      stripe_refund_id: stripeRefundId,
      message: ticket.purchase_amount_cents
        ? "Refund issued — funds typically appear within 5–10 business days"
        : "Ticket cancelled successfully",
    });
  } catch (err: any) {
    console.error("[ticket-refund]", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
}));
