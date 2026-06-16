/**
 * cancel-event Edge Function
 *
 * POST /cancel-event
 * Body: { eventId: number, reason?: string }
 *
 * Host-only. Cancels an event and cascades refunds for every active
 * ticket. NEVER hard-deletes the event row — status flips to
 * 'cancelled'. Hard delete is only safe via the (hardened) delete-event
 * function and only when no tickets exist.
 *
 * Refund strategy: group tickets by stripe_payment_intent_id (PI-level
 * refunds cover all tickets that share that PI in one call) and issue
 * one Stripe refund per unique PI with an idempotency key derived from
 * the event id + PI so retries are exactly-once. The
 * `stripe-webhook` charge.refunded handler updates each ticket row to
 * status='refunded' as the events land — we don't pre-flip here to
 * avoid lying to the UI if Stripe rejects the refund.
 *
 * Free tickets (no PI) get voided directly here.
 *
 * Notifications: every ticket holder gets push + in-app. We do NOT
 * block cancellation on email/push delivery — they are best-effort.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!STRIPE_SECRET_KEY) {
  console.error("[cancel-event] FATAL: STRIPE_SECRET_KEY not set.");
}

function json(data: unknown, status = 200, req?: Request) {
  const headers = req
    ? { ...corsHeaders(req), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), { status, headers });
}

async function stripeRefund(
  body: Record<string, string>,
  idempotencyKey: string,
): Promise<{ id?: string; status?: string; error?: any }> {
  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST")
    return json({ error: "Method not allowed" }, 405, req);

  if (!STRIPE_SECRET_KEY) {
    return json({ error: "Stripe not configured" }, 503, req);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return json({ error: "Unauthorized" }, 401, req);

    const rl = checkRateLimit(authId, "cancel-event", {
      maxRequests: 5,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return json({ error: "Too many cancel requests" }, 429, req);
    }

    let body: { eventId?: number; reason?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, req);
    }

    const eventId = Number(body.eventId);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return json({ error: "eventId required" }, 400, req);
    }
    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;

    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("id, host_id, status, title")
      .eq("id", eventId)
      .maybeSingle();
    if (eventErr || !event) {
      return json({ error: "Event not found" }, 404, req);
    }
    if (String(event.host_id) !== String(authId)) {
      return json({ error: "Not your event" }, 403, req);
    }
    if (event.status === "cancelled") {
      return json({ ok: true, alreadyCancelled: true }, 200, req);
    }

    // Mark cancelled FIRST so subsequent reads (including any in-flight
    // scanner attempts) see the cancellation state.
    const { error: cancelErr } = await supabase
      .from("events")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason,
      })
      .eq("id", eventId);
    if (cancelErr) {
      console.error("[cancel-event] mark cancelled failed:", cancelErr);
      return json({ error: "Failed to mark cancelled" }, 500, req);
    }

    const { data: tickets } = await supabase
      .from("tickets")
      .select(
        "id, user_id, status, stripe_payment_intent_id, purchase_amount_cents",
      )
      .eq("event_id", eventId)
      .in("status", ["active", "transfer_pending", "scanned"]);

    const refundResults: Array<{
      pi: string;
      ok: boolean;
      refundId?: string;
      error?: string;
    }> = [];
    const voidedFreeIds: string[] = [];
    const piToTickets = new Map<string, string[]>();

    for (const t of tickets || []) {
      if (t.stripe_payment_intent_id) {
        const arr = piToTickets.get(t.stripe_payment_intent_id) || [];
        arr.push(t.id);
        piToTickets.set(t.stripe_payment_intent_id, arr);
      } else {
        voidedFreeIds.push(t.id);
      }
    }

    if (voidedFreeIds.length > 0) {
      await supabase
        .from("tickets")
        .update({ status: "void" })
        .in("id", voidedFreeIds);
    }

    for (const [pi, ticketIds] of piToTickets) {
      const idempotencyKey = `cancel-event-${eventId}-${pi}`;
      const result = await stripeRefund(
        {
          payment_intent: pi,
          refund_application_fee: "true",
          reverse_transfer: "true",
          "metadata[reason]": reason || "event_cancelled",
          "metadata[event_id]": String(eventId),
          "metadata[ticket_ids]": ticketIds.join(","),
        },
        idempotencyKey,
      );
      if ((result as any).error) {
        console.error(
          `[cancel-event] Stripe refund failed for PI ${pi}:`,
          (result as any).error,
        );
        refundResults.push({
          pi,
          ok: false,
          error: (result as any).error?.message,
        });
      } else {
        refundResults.push({ pi, ok: true, refundId: (result as any).id });
      }
    }

    // Best-effort: push + in-app notifications to every affected user.
    try {
      const affectedUserIds = Array.from(
        new Set(
          (tickets || []).map((t) => t.user_id).filter(Boolean) as string[],
        ),
      );
      if (affectedUserIds.length > 0) {
        const { data: userRows } = await supabase
          .from("users")
          .select("id, auth_id")
          .in("auth_id", affectedUserIds);
        const intIds = (userRows || []).map((r: any) => r.id);

        if (intIds.length > 0) {
          await supabase.from("notifications").insert(
            intIds.map((uid: number) => ({
              recipient_id: uid,
              actor_id: null,
              type: "event_cancelled",
              entity_type: "event",
              entity_id: String(eventId),
            })),
          );

          const { data: tokens } = await supabase
            .from("push_tokens")
            .select("token, user_id")
            .in("user_id", intIds);

          if (tokens && tokens.length > 0) {
            const messages = tokens.map((t: any) => ({
              to: t.token,
              title: "Event cancelled",
              body: `${event.title || "An event you have a ticket to"} was cancelled. You'll be refunded shortly.`,
              data: {
                type: "event_cancelled",
                entityType: "event",
                entityId: String(eventId),
                url: `https://dvntapp.live/e/${eventId}`,
              },
              sound: "default",
              channelId: "default",
            }));
            await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify(messages),
            });
          }
        }
      }
    } catch (notifyErr) {
      console.warn(
        "[cancel-event] notify-attendees failed (non-fatal):",
        notifyErr,
      );
    }

    return json(
      {
        ok: true,
        eventId,
        refundsIssued: refundResults.filter((r) => r.ok).length,
        refundsFailed: refundResults.filter((r) => !r.ok).length,
        freeTicketsVoided: voidedFreeIds.length,
        affectedTickets: (tickets || []).length,
      },
      200,
      req,
    );
  } catch (err: any) {
    console.error("[cancel-event] Unexpected:", err);
    return json({ error: err.message || "Internal error" }, 500, req);
  }
});
