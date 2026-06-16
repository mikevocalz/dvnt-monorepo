/**
 * Organizer-initiated refund
 *
 * POST /organizer-refund
 * Body: { ticket_id }
 *
 * Host-only. Refunds the full charge associated with the ticket via
 * Stripe (refund_application_fee + reverse_transfer, so DVNT's fee
 * and the organizer's transferred share both flow back to the
 * cardholder). The Stripe `charge.refunded` webhook does the actual
 * state sync (tickets → refunded, orders → refunded, wallet passes
 * voided, event_financials decremented) so this endpoint stays small
 * and auditable.
 *
 * Free tickets (no payment_intent) are voided directly here — no
 * Stripe call needed.
 *
 * Important limitation: a payment_intent can back MULTIPLE tickets if
 * the buyer purchased quantity > 1. Stripe refunds are per-PI, so
 * refunding one ticket from a group refunds the whole order. The
 * caller is expected to surface a confirmation before calling this.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { notifyNextWaitlister } from "../_shared/notify-waitlisters.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[organizer-refund] FATAL: STRIPE_SECRET_KEY env var is not set.",
  );
}

async function stripeRefund(
  body: Record<string, string>,
): Promise<{ id?: string; status?: string; error?: any }> {
  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
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

    // Rate limit: a host issuing more than 20 refunds per minute is
    // either automating or phishing. Legit refund traffic is < 5/min.
    const rl = checkRateLimit(authId, "organizer-refund", {
      maxRequests: 20,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return errorResponse("Too many refund requests", 429);
    }

    let body: { ticket_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : "";
    if (!ticketId) return errorResponse("ticket_id required", 400);

    const { data: ticket, error: ticketErr } = await supabase
      .from("tickets")
      .select(
        "id, event_id, ticket_type_id, status, stripe_payment_intent_id, purchase_amount_cents",
      )
      .eq("id", ticketId)
      .maybeSingle();

    if (ticketErr) {
      console.error("[organizer-refund] ticket lookup:", ticketErr);
      return errorResponse("Could not fetch ticket", 500);
    }
    if (!ticket) return errorResponse("Ticket not found", 404);

    // Host authorization — only the event's host can issue a refund
    const { data: event } = await supabase
      .from("events")
      .select("host_id")
      .eq("id", ticket.event_id)
      .maybeSingle();
    if (!event) return errorResponse("Event not found", 404);
    if (String(event.host_id) !== String(authId)) {
      return errorResponse("Not your event", 403);
    }

    // Disallow refund on tickets that are already refunded / voided
    if (ticket.status === "refunded" || ticket.status === "void") {
      return errorResponse("Ticket is already refunded", 400);
    }
    // After check-in we also disallow — the organizer probably meant a
    // different ticket. Force a manual override by un-checking-in first
    // if they truly need to refund a scanned ticket.
    if (ticket.status === "scanned") {
      return errorResponse(
        "Ticket has been checked in — cannot refund automatically",
        400,
      );
    }

    // Free tickets: no Stripe call, just void directly. The paid path
    // flows through charge.refunded which handles inventory + waitlist
    // promotion; do the same inline here.
    if (!ticket.stripe_payment_intent_id) {
      const { error: updateErr } = await supabase
        .from("tickets")
        .update({ status: "refunded" })
        .eq("id", ticketId);
      if (updateErr) {
        console.error("[organizer-refund] void error:", updateErr);
        return errorResponse("Could not void ticket", 500);
      }

      if (ticket.ticket_type_id) {
        const { data: tt } = await supabase
          .from("ticket_types")
          .select("quantity_sold, name, event_id")
          .eq("id", ticket.ticket_type_id)
          .maybeSingle();
        if (tt) {
          await supabase
            .from("ticket_types")
            .update({
              quantity_sold: Math.max(0, (tt.quantity_sold ?? 0) - 1),
            })
            .eq("id", ticket.ticket_type_id);
          const { data: ev } = await supabase
            .from("events")
            .select("title")
            .eq("id", ticket.event_id)
            .maybeSingle();
          await notifyNextWaitlister(supabase, {
            eventId: ticket.event_id,
            ticketTypeId: String(ticket.ticket_type_id),
            tierName: tt.name,
            eventTitle: ev?.title ?? null,
          });
        }
      }

      return jsonResponse({
        ok: true,
        free: true,
        message: "Ticket voided (no charge to refund)",
      });
    }

    // Paid path — issue a Stripe refund. Stripe's charge.refunded
    // webhook handles the rest (tickets → refunded, wallet void,
    // order status, event_financials, refund_requests closure).
    const refundParams: Record<string, string> = {
      payment_intent: ticket.stripe_payment_intent_id,
      // Return DVNT's application fee to the cardholder
      refund_application_fee: "true",
      // Reverse the transfer to the organizer's connected account
      reverse_transfer: "true",
      // Metadata so the webhook can log the trigger
      "metadata[triggered_by]": "organizer",
      "metadata[triggered_by_auth_id]": authId,
      "metadata[ticket_id]": ticketId,
    };

    const stripeResp = await stripeRefund(refundParams);
    if (stripeResp.error) {
      console.error(
        "[organizer-refund] stripe error:",
        stripeResp.error,
      );
      return errorResponse(
        typeof stripeResp.error === "object" && stripeResp.error.message
          ? `Stripe: ${stripeResp.error.message}`
          : "Stripe refund failed",
        400,
      );
    }

    return jsonResponse({
      ok: true,
      refund_id: stripeResp.id,
      status: stripeResp.status,
      // NOTE: the ticket DB row flips to "refunded" on the
      // charge.refunded webhook (usually within a few seconds).
      note: "Refund created in Stripe; tickets update via webhook.",
    });
  } catch (err) {
    console.error("[organizer-refund] unexpected:", err);
    return errorResponse("Internal error", 500);
  }
});
