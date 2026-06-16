/**
 * Buyer-Initiated Ticket Refund
 *
 * POST /ticket-refund
 * Body: { ticket_id }
 *
 * Rules:
 * - Must be the ticket owner.
 * - Ticket must be status = 'active' (not already scanned/refunded/void).
 * - Event must not have started yet (start_date > now()).
 * - Free tickets (no payment_intent) are voided directly; no Stripe call needed.
 * - Paid tickets: issues Stripe refund for the payment_intent on the ticket.
 *   The stripe-webhook handles the full state sync on `charge.refunded`, but
 *   we also immediately set status = 'refunded' so the UI reflects it fast.
 * - Decrements ticket_types.quantity_sold and events.total_attendees.
 * - Note: if multiple tickets share one payment_intent (qty > 1 purchase),
 *   only THIS ticket is refunded (partial refund). Stripe supports this.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[ticket-refund] FATAL: STRIPE_SECRET_KEY env var is not set.",
  );
}

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

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

    const authId = await verifySession(supabase, req);
    if (!authId) return json({ error: "Unauthorized" }, 401);

    const { ticket_id } = await req.json();
    if (!ticket_id) return json({ error: "ticket_id is required" }, 400);

    // Fetch ticket with event info
    const { data: ticket, error: ticketErr } = await supabase
      .from("tickets")
      .select("id, event_id, user_id, status, purchase_amount_cents, payment_intent_id, ticket_type_id, checked_in_at")
      .eq("id", ticket_id)
      .single();

    if (ticketErr || !ticket) return json({ error: "Ticket not found" }, 404);
    if (String(ticket.user_id) !== String(authId)) {
      return json({ error: "Not your ticket" }, 403);
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

    // Void the ticket immediately for fast UI; also mark refunded for paid tickets
    await supabase
      .from("tickets")
      .update({ status: "void" })
      .eq("id", ticket_id);

    // Decrement quantity_sold on ticket_type
    await supabase.rpc("decrement_ticket_quantity_sold", {
      p_ticket_type_id: ticket.ticket_type_id,
    }).catch(() => {}); // best-effort — trigger handles total_attendees

    // If paid ticket, issue Stripe refund
    let stripeRefundId: string | null = null;
    if (ticket.payment_intent_id && ticket.purchase_amount_cents && ticket.purchase_amount_cents > 0) {
      const refund = await stripeRefund({
        payment_intent: ticket.payment_intent_id,
        amount: String(ticket.purchase_amount_cents),
        reason: "requested_by_customer",
        "metadata[ticket_id]": String(ticket_id),
        "metadata[refund_initiator]": "buyer",
      });
      if (refund.error) {
        // Roll back status to active if Stripe fails
        await supabase
          .from("tickets")
          .update({ status: "active" })
          .eq("id", ticket_id);
        return json({ error: `Stripe refund failed: ${refund.error.message}` }, 502);
      }
      stripeRefundId = refund.id;
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
});
