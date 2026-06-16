/**
 * bulk-refund-tickets Edge Function
 *
 * POST /bulk-refund-tickets
 * Body: { event_id: number, ticket_ids: string[], reason?: string }
 *
 * Owner-only. Refunds each ticket individually:
 *   - paid tickets → Stripe partial refund on the ticket's PI (amount =
 *     purchase_amount_cents), with idempotency key bulk-refund-{ticketId}
 *     so retries are exactly-once.
 *   - free tickets → status flipped to 'void' in this fn (no Stripe).
 *
 * The Stripe webhook (charge.refunded) will flip paid-ticket status to
 * 'refunded' as the refund event lands. We do not pre-flip here to
 * avoid lying to the UI if Stripe rejects the refund.
 *
 * Returns per-ticket outcomes:
 *   { ok: true, data: { refunded, voided, failures: [{ticketId, error}] } }
 *
 * Rate limited 2 per 5 minutes per (sender, event).
 *
 * Co-organizers are NOT allowed to refund — only the event owner.
 * Refunding moves money and is a no-take-backs operation; we keep
 * the blast radius tight to the owner.
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

const MAX_BATCH = 50;

if (!STRIPE_SECRET_KEY) {
  console.error("[bulk-refund-tickets] FATAL: STRIPE_SECRET_KEY not set.");
}

function json(data: unknown, status = 200, req?: Request) {
  const headers = req
    ? { ...corsHeaders(req), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), { status, headers });
}

function errResp(message: string, status: number, req: Request) {
  return json({ ok: false, error: { message } }, status, req);
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
  const data = await res.json();
  if (!res.ok) return { error: data };
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errResp("Method not allowed", 405, req);

  try {
    if (!STRIPE_SECRET_KEY) {
      return errResp(
        "Stripe is not configured for this environment. Contact support.",
        503,
        req,
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return errResp("Unauthorized", 401, req);

    let body: {
      event_id?: number | string;
      ticket_ids?: string[];
      reason?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return errResp("Invalid JSON body", 400, req);
    }

    const eventId = Number(body.event_id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return errResp("event_id required", 400, req);
    }
    const ticketIds = Array.isArray(body.ticket_ids)
      ? Array.from(new Set(body.ticket_ids.map(String).filter(Boolean)))
      : [];
    if (ticketIds.length === 0) {
      return errResp("ticket_ids required", 400, req);
    }
    if (ticketIds.length > MAX_BATCH) {
      return errResp(
        `Batch too large; max ${MAX_BATCH} tickets per call`,
        400,
        req,
      );
    }

    // Event must exist + caller must be the owner.
    const { data: event } = await supabase
      .from("events")
      .select("id, host_id, title")
      .eq("id", eventId)
      .maybeSingle();
    if (!event) return errResp("Event not found", 404, req);
    if (String(event.host_id) !== String(authId)) {
      return errResp("Only the event owner can issue refunds", 403, req);
    }

    const rl = checkRateLimit(authId, `bulk-refund:${eventId}`, {
      maxRequests: 2,
      windowMs: 5 * 60_000,
    });
    if (!rl.allowed) {
      return errResp(
        "Too many refund batches. Wait a few minutes and try again.",
        429,
        req,
      );
    }

    // Pull the target tickets.
    const { data: tickets, error: tErr } = await supabase
      .from("tickets")
      .select(
        "id, event_id, user_id, status, purchase_amount_cents, stripe_payment_intent_id",
      )
      .eq("event_id", eventId)
      .in("id", ticketIds);
    if (tErr) {
      console.error("[bulk-refund-tickets] tickets fetch:", tErr);
      return errResp("Could not load tickets", 500, req);
    }

    const failures: { ticketId: string; error: string }[] = [];
    const voided: string[] = [];
    const refundsAttempted: string[] = [];

    // Track which tickets to push notify (those that we touched
    // successfully, whether voided or queued for Stripe refund).
    const successUserIds = new Set<string>();

    for (const t of tickets || []) {
      if (
        t.status === "refunded" ||
        t.status === "void" ||
        t.status === "scanned"
      ) {
        // scanned tickets should not be auto-refunded — host might do
        // it manually with a per-ticket flow. Skip silently here.
        failures.push({
          ticketId: t.id,
          error: `Cannot bulk-refund a ${t.status} ticket`,
        });
        continue;
      }

      const amount = Number(t.purchase_amount_cents || 0);
      const pi = t.stripe_payment_intent_id;

      if (amount > 0 && pi) {
        const result = await stripeRefund(
          {
            payment_intent: pi,
            amount: String(amount),
            refund_application_fee: "true",
            reverse_transfer: "true",
            "metadata[ticket_id]": t.id,
            "metadata[event_id]": String(eventId),
            "metadata[bulk_reason]": (body.reason || "").slice(0, 100),
          },
          `bulk-refund-${t.id}`,
        );
        if (result.error) {
          console.warn(
            "[bulk-refund-tickets] Stripe refund failed for",
            t.id,
            result.error,
          );
          failures.push({
            ticketId: t.id,
            error:
              result.error?.message ||
              "Stripe refused the refund",
          });
          continue;
        }
        refundsAttempted.push(t.id);
        if (t.user_id) successUserIds.add(String(t.user_id));
      } else {
        // Free ticket → void directly.
        const { error: voidErr } = await supabase
          .from("tickets")
          .update({ status: "void" })
          .eq("id", t.id);
        if (voidErr) {
          failures.push({
            ticketId: t.id,
            error: "Could not void free ticket",
          });
          continue;
        }
        voided.push(t.id);
        if (t.user_id) successUserIds.add(String(t.user_id));
      }
    }

    // In-app notifications + push for everyone whose ticket was touched.
    if (successUserIds.size > 0) {
      const { data: userRows } = await supabase
        .from("users")
        .select("id, auth_id")
        .in("auth_id", Array.from(successUserIds));
      const intIds = (userRows || [])
        .map((r: any) => r.id)
        .filter((id: any) => typeof id === "number");

      if (intIds.length > 0) {
        const reason = (body.reason || "").toString().trim().slice(0, 240);
        await supabase.from("notifications").insert(
          intIds.map((uid: number) => ({
            recipient_id: uid,
            actor_id: null,
            type: "ticket_refunded",
            entity_type: "event",
            entity_id: String(eventId),
            entity_payload: {
              title: event.title || "Refund issued",
              body:
                reason ||
                `Your ticket to ${event.title || "the event"} has been refunded.`,
            },
          })),
        );

        const { data: tokens } = await supabase
          .from("push_tokens")
          .select("token")
          .in("user_id", intIds);
        if (tokens && tokens.length > 0) {
          const messages = tokens.map((t: any) => ({
            to: t.token,
            title: `${event.title || "Event"}: Refund issued`,
            body:
              reason ||
              "Your ticket has been refunded. Funds return in 5-10 business days.",
            data: {
              type: "ticket_refunded",
              entityType: "event",
              entityId: String(eventId),
              url: `https://dvntapp.live/e/${eventId}`,
            },
            sound: "default",
            channelId: "default",
          }));
          try {
            await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify(messages),
            });
          } catch (pushErr) {
            console.warn("[bulk-refund-tickets] push failed:", pushErr);
          }
        }
      }
    }

    return json(
      {
        ok: true,
        data: {
          refunded: refundsAttempted.length,
          voided: voided.length,
          failures,
        },
      },
      200,
      req,
    );
  } catch (e: any) {
    console.error("[bulk-refund-tickets] unexpected:", e);
    return errResp(e?.message || "Internal error", 500, req);
  }
});
