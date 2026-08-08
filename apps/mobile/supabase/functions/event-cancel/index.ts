/**
 * event-cancel Edge Function — WS-9 cancel-with-auto-refund orchestrator.
 *
 * POST /event-cancel
 * Body: { eventId: number, reason?: string }
 *
 * Owner or accepted ADMIN co-organizer (same callerRole bar as
 * event-broadcast-message / get-event-staff). Supersedes the legacy
 * `cancel-event` fn (owner-only, no batching/resume, no waitlist
 * close-out, no guest email) — that directory is frozen by the identity
 * consolidation sweep, so the WS-9 orchestration lands here.
 *
 * Flow (every step idempotent — the fn is safely re-invokable):
 *   1. events.status → 'cancelled' + cancelled_at + cancel_reason
 *      (only stamped on the first transition; a re-invoke of an
 *      already-cancelled event becomes a RESUME run for refunds).
 *   2. Waitlist close-out: stamp notified_at on open rows so the
 *      charge.refunded webhook's notifyNextWaitlister never promotes
 *      anyone onto a dead event; best-effort offer_status='expired'.
 *   3. Paid-order refund sweep, in batches of ORDER_BATCH per invoke:
 *        - whole-PI Stripe refund (refund_application_fee +
 *          reverse_transfer — the exact semantics of the existing
 *          cancel/organizer-refund machinery),
 *        - Stripe Idempotency-Key `event-cancel-{eventId}-{orderId}`
 *          so a crash-and-retry can never double-refund,
 *        - progress marker in order_timeline
 *          (type 'refund_requested', detail 'event-cancel:{eventId} …')
 *          — the resume run skips orders that already carry the marker,
 *        - guest orders (guest_email, no user) get a Resend email at
 *          the moment their refund is accepted (marker-gated, so a
 *          resume never re-emails).
 *      Ticket/order status flips stay with the stripe-webhook
 *      charge.refunded handler — we never pre-flip and lie to the UI.
 *   4. Legacy safety net: tickets whose PI has no orders row are
 *      grouped by PI and refunded with the legacy fn's key format
 *      (`cancel-event-{eventId}-{pi}`) so Stripe dedupes if the old
 *      path ever ran. Free tickets (no PI) are voided directly.
 *   5. Push + in-app notification to every ticket holder — fired only
 *      on the run that actually performed the status transition.
 *
 * Returns { ok, done, remainingOrders, ... }. When done=false the
 * client re-invokes to resume (see eventsApi.cancelEventWithRefunds).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { sendResendEmail, broadcast } from "../_shared/send-resend-email.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Max Stripe refunds issued per invocation — keeps a big event well
 * inside the edge-fn wall clock; the client resumes until done. */
const ORDER_BATCH = 25;
/** Marker prefix written into order_timeline.detail. The resume
 * predicate greps for this — do not change without a backfill. */
const MARKER = (eventId: number) => `event-cancel:${eventId}`;

if (!STRIPE_SECRET_KEY) {
  console.error("[event-cancel] FATAL: STRIPE_SECRET_KEY not set.");
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
  const data = await res.json();
  if (!res.ok) return { error: data?.error ?? data };
  return data;
}

/** Whole-PI already fully refunded is a success for our purposes. */
function isAlreadyRefunded(error: any): boolean {
  return error?.code === "charge_already_refunded";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST")
    return json({ ok: false, error: { message: "Method not allowed" } }, 405, req);

  if (!STRIPE_SECRET_KEY) {
    return json(
      { ok: false, error: { message: "Stripe not configured" } },
      503,
      req,
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId)
      return json({ ok: false, error: { message: "Unauthorized" } }, 401, req);

    let body: { eventId?: number | string; reason?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json(
        { ok: false, error: { message: "Invalid JSON body" } },
        400,
        req,
      );
    }

    const eventId = Number(body.eventId);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return json(
        { ok: false, error: { message: "eventId required" } },
        400,
        req,
      );
    }
    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;

    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select(
        "id, host_id, status, title, cancelled_at, cancel_reason, flyer_image_url, cover_image_url, dominant_color",
      )
      .eq("id", eventId)
      .maybeSingle();
    if (eventErr || !event) {
      return json(
        { ok: false, error: { message: "Event not found" } },
        404,
        req,
      );
    }

    // Permission: owner OR accepted admin co-organizer — exactly the
    // broadcast/staff callerRole bar. Editors/scanners are denied:
    // cancelling moves money.
    const isOwner = String(event.host_id) === String(authId);
    if (!isOwner) {
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role, accepted")
        .eq("event_id", eventId)
        .eq("user_id", authId)
        .eq("accepted", true)
        .eq("role", "admin")
        .maybeSingle();
      if (!coOrg) {
        return json(
          {
            ok: false,
            error: {
              message:
                "Only the event owner or an admin co-organizer can cancel this event",
            },
          },
          403,
          req,
        );
      }
    }

    // 10/min: a resume loop legitimately re-invokes several times.
    const rl = checkRateLimit(authId, `event-cancel:${eventId}`, {
      maxRequests: 10,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return json(
        { ok: false, error: { message: "Too many cancel requests" } },
        429,
        req,
      );
    }

    // ── 1. Status transition (first run only) ─────────────────────────
    const firstRun = event.status !== "cancelled";
    if (firstRun) {
      const { error: cancelErr } = await supabase
        .from("events")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancel_reason: reason,
        })
        .eq("id", eventId)
        .neq("status", "cancelled"); // races with a concurrent cancel resolve to one transition
      if (cancelErr) {
        console.error("[event-cancel] mark cancelled failed:", cancelErr);
        return json(
          { ok: false, error: { message: "Failed to mark cancelled" } },
          500,
          req,
        );
      }
    }
    const effectiveReason = reason || event.cancel_reason || null;

    // ── 2. Waitlist close-out (idempotent; BEFORE refunds so the
    //       webhook's notifyNextWaitlister finds no open rows) ─────────
    let waitlistClosed = 0;
    {
      const { data: closed, error: wlErr } = await supabase
        .from("event_waitlist")
        .update({ notified_at: new Date().toISOString() })
        .eq("event_id", eventId)
        .is("notified_at", null)
        .select("id");
      if (wlErr) {
        console.warn("[event-cancel] waitlist close-out failed:", wlErr);
      } else {
        waitlistClosed = closed?.length ?? 0;
      }
      // Best-effort: offer_status column ships with the waitlist
      // auto-offer migration on this branch; tolerate its absence.
      const { error: offerErr } = await supabase
        .from("event_waitlist")
        .update({ offer_status: "expired" })
        .eq("event_id", eventId)
        .in("offer_status", ["none", "offered"]);
      if (offerErr) {
        console.warn(
          "[event-cancel] offer_status close-out skipped:",
          offerErr.message,
        );
      }
    }

    // ── 3. Paid-order refund sweep (batched, marker-resumable) ────────
    const { data: candidateOrders, error: ordersErr } = await supabase
      .from("orders")
      .select("id, status, stripe_payment_intent_id, total_cents, guest_email")
      .eq("event_id", eventId)
      .eq("type", "event_ticket")
      .in("status", ["paid", "partially_refunded"])
      .order("created_at", { ascending: true });
    if (ordersErr) {
      console.error("[event-cancel] orders fetch failed:", ordersErr);
      return json(
        { ok: false, error: { message: "Could not load orders" } },
        500,
        req,
      );
    }

    // Orders already carrying our progress marker are done — the
    // webhook may not have flipped orders.status yet, so the marker
    // (not the status) is the resume predicate.
    const processedIds = new Set<string>();
    const allIds = (candidateOrders || []).map((o: any) => o.id);
    if (allIds.length > 0) {
      const { data: markers } = await supabase
        .from("order_timeline")
        .select("order_id, detail")
        .in("order_id", allIds)
        .eq("type", "refund_requested")
        .ilike("detail", `${MARKER(eventId)}%`);
      for (const m of markers || []) processedIds.add(m.order_id);
    }

    const pending = (candidateOrders || []).filter(
      (o: any) => !processedIds.has(o.id),
    );
    const batch = pending.slice(0, ORDER_BATCH);

    let refundsIssued = 0;
    let refundsFailed = 0;
    let guestEmailsSent = 0;
    const failures: { orderId: string; error: string }[] = [];
    const handledPIs = new Set<string>();
    for (const o of candidateOrders || []) {
      if (o.stripe_payment_intent_id) handledPIs.add(o.stripe_payment_intent_id);
    }

    const emailContent = (kind: "refund" | "notice") =>
      broadcast({
        eventTitle: event.title || "Your event",
        message:
          kind === "refund"
            ? `${event.title || "This event"} has been cancelled by the host.` +
              (effectiveReason ? `\n\nReason: ${effectiveReason}` : "") +
              `\n\nYour payment has been refunded in full — funds typically return to your card in 5–10 business days. Your ticket is no longer valid.`
            : `${event.title || "This event"} has been cancelled by the host.` +
              (effectiveReason ? `\n\nReason: ${effectiveReason}` : "") +
              `\n\nYour ticket is no longer valid.`,
        flyerUrl: event.flyer_image_url || event.cover_image_url || null,
        dominantColor: event.dominant_color || null,
        ctaUrl: `https://dvntapp.live/e/${eventId}`,
        ctaLabel: "View event",
      });

    for (const order of batch) {
      const pi = order.stripe_payment_intent_id;
      const amount = Number(order.total_cents || 0);

      let refundId: string | null = null;
      if (pi && amount > 0) {
        const result = await stripeRefund(
          {
            payment_intent: pi,
            refund_application_fee: "true",
            reverse_transfer: "true",
            "metadata[reason]": effectiveReason || "event_cancelled",
            "metadata[event_id]": String(eventId),
            "metadata[order_id]": order.id,
          },
          `event-cancel-${eventId}-${order.id}`,
        );
        if (result.error && !isAlreadyRefunded(result.error)) {
          console.warn(
            `[event-cancel] Stripe refund failed for order ${order.id}:`,
            result.error,
          );
          refundsFailed++;
          failures.push({
            orderId: order.id,
            error: result.error?.message || "Stripe refused the refund",
          });
          continue; // no marker — the resume run retries this order
        }
        refundId = result.id ?? null;
        refundsIssued++;
      }
      // pi-less / zero-total "paid" orders (comps, RSVP issuance): no
      // money to move — marker only, so they never re-enter the sweep.

      const { error: markerErr } = await supabase
        .from("order_timeline")
        .insert({
          order_id: order.id,
          type: "refund_requested",
          label: "Event cancelled — refund initiated",
          detail:
            `${MARKER(eventId)}` +
            (refundId ? ` stripe_refund:${refundId}` : " no-charge"),
        });
      if (markerErr) {
        // Refund is safe either way (Stripe idempotency key); the
        // resume run will re-hit Stripe and get the same refund back.
        console.warn("[event-cancel] marker insert failed:", markerErr);
      }

      // Guest orders: transactional email at refund time. Marker-gated
      // (we only reach here once per order), so resumes never re-send.
      if (order.guest_email) {
        try {
          await sendResendEmail({
            to: order.guest_email,
            ...emailContent(pi && amount > 0 ? "refund" : "notice"),
          });
          guestEmailsSent++;
        } catch (mailErr) {
          console.warn(
            "[event-cancel] guest email failed (non-fatal):",
            mailErr,
          );
        }
      }
    }

    const remainingOrders = pending.length - batch.length + refundsFailed;

    // ── 4. Ticket safety net: free tickets void + legacy PI refunds ──
    let freeTicketsVoided = 0;
    let legacyPiRefunds = 0;
    const { data: openTickets } = await supabase
      .from("tickets")
      .select("id, status, stripe_payment_intent_id, user_id, guest_email")
      .eq("event_id", eventId)
      .in("status", ["active", "transfer_pending"]);

    const freeIds = (openTickets || [])
      .filter((t: any) => !t.stripe_payment_intent_id)
      .map((t: any) => t.id);
    if (freeIds.length > 0) {
      const { error: voidErr } = await supabase
        .from("tickets")
        .update({ status: "void" })
        .in("id", freeIds);
      if (voidErr) {
        console.warn("[event-cancel] free-ticket void failed:", voidErr);
      } else {
        freeTicketsVoided = freeIds.length;
      }
    }

    // Tickets whose PI never got an orders row (pre-20260310 legacy):
    // whole-PI refund with the LEGACY key format so Stripe dedupes
    // against any historical cancel-event run.
    const legacyPis = new Set<string>();
    for (const t of openTickets || []) {
      if (t.stripe_payment_intent_id && !handledPIs.has(t.stripe_payment_intent_id)) {
        legacyPis.add(t.stripe_payment_intent_id);
      }
    }
    for (const pi of legacyPis) {
      if (legacyPiRefunds + batch.length >= ORDER_BATCH) break; // shared budget
      const result = await stripeRefund(
        {
          payment_intent: pi,
          refund_application_fee: "true",
          reverse_transfer: "true",
          "metadata[reason]": effectiveReason || "event_cancelled",
          "metadata[event_id]": String(eventId),
        },
        `cancel-event-${eventId}-${pi}`,
      );
      if (result.error && !isAlreadyRefunded(result.error)) {
        console.warn(`[event-cancel] legacy PI refund failed ${pi}:`, result.error);
        refundsFailed++;
      } else {
        legacyPiRefunds++;
      }
    }

    // ── 5. Attendee push + in-app (transition run only) ───────────────
    let notified = 0;
    if (firstRun) {
      try {
        const affectedAuthIds = Array.from(
          new Set(
            (openTickets || [])
              .map((t: any) => t.user_id)
              .filter(Boolean) as string[],
          ),
        );
        if (affectedAuthIds.length > 0) {
          const { data: userRows } = await supabase
            .from("users")
            .select("id, auth_id")
            .in("auth_id", affectedAuthIds);
          const intIds = (userRows || []).map((r: any) => r.id);

          if (intIds.length > 0) {
            await supabase.from("notifications").insert(
              intIds.map((uid: number) => ({
                recipient_id: uid,
                actor_id: null,
                type: "event_cancelled",
                entity_type: "event",
                entity_id: String(eventId),
                entity_payload: {
                  title: event.title || "Event cancelled",
                  body: effectiveReason
                    ? `Cancelled by the host: ${effectiveReason}. Paid tickets are being refunded.`
                    : "Cancelled by the host. Paid tickets are being refunded.",
                },
              })),
            );
            notified = intIds.length;

            const { data: tokens } = await supabase
              .from("push_tokens")
              .select("token")
              .in("user_id", intIds);
            if (tokens && tokens.length > 0) {
              const messages = tokens.map((t: any) => ({
                to: t.token,
                title: "Event cancelled",
                body: `${event.title || "An event you have a ticket to"} was cancelled. Paid tickets are refunded automatically.`,
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
        console.warn("[event-cancel] notify failed (non-fatal):", notifyErr);
      }
    }

    return json(
      {
        ok: true,
        eventId,
        status: "cancelled",
        done: remainingOrders <= 0,
        remainingOrders: Math.max(0, remainingOrders),
        processedOrders: batch.length,
        refundsIssued,
        refundsFailed,
        legacyPiRefunds,
        freeTicketsVoided,
        guestEmailsSent,
        waitlistClosed,
        notified,
        failures,
        resumed: !firstRun,
      },
      200,
      req,
    );
  } catch (err: any) {
    console.error("[event-cancel] Unexpected:", err);
    return json(
      { ok: false, error: { message: err?.message || "Internal error" } },
      500,
      req,
    );
  }
});
