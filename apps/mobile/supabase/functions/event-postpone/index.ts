/**
 * event-postpone Edge Function — WS-9 reversible postpone.
 *
 * POST /event-postpone
 * Body: { eventId: number, action?: "postpone" | "resume", note?: string }
 *
 * Owner or accepted ADMIN co-organizer (same callerRole bar as
 * event-broadcast-message / event-cancel).
 *
 *   postpone: 'active' → 'postponed'
 *   resume:   'postponed' → 'active'
 *
 * NO refunds are issued — tickets remain valid for the rescheduled
 * date. Attendees (push + in-app) and guest orders (Resend email) are
 * told exactly that.
 *
 * WS-5 SEAM: a host-configurable refund-policy window ("postponed
 * events open a 14-day refund window per host policy") belongs to the
 * WS-5 refund-policy work. When that lands, this fn should stamp the
 * window open (e.g. events.refund_window_ends_at) and the copy below
 * should surface it. Until then postponement is notify-only.
 *
 * Idempotent: repeating an action the event is already in returns
 * { ok, already: true } and sends nothing.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { sendResendEmail, broadcast } from "../_shared/send-resend-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(data: unknown, status = 200, req?: Request) {
  const headers = req
    ? { ...corsHeaders(req), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), { status, headers });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST")
    return json({ ok: false, error: { message: "Method not allowed" } }, 405, req);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId)
      return json({ ok: false, error: { message: "Unauthorized" } }, 401, req);

    let body: {
      eventId?: number | string;
      action?: string;
      note?: string;
    } = {};
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
    const action: "postpone" | "resume" =
      body.action === "resume" ? "resume" : "postpone";
    const note =
      typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select(
        "id, host_id, status, title, flyer_image_url, cover_image_url, dominant_color",
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

    // Permission: owner OR accepted admin co-organizer.
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
                "Only the event owner or an admin co-organizer can do this",
            },
          },
          403,
          req,
        );
      }
    }

    const rl = checkRateLimit(authId, `event-postpone:${eventId}`, {
      maxRequests: 5,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return json(
        { ok: false, error: { message: "Too many requests" } },
        429,
        req,
      );
    }

    const fromStatus = action === "postpone" ? "active" : "postponed";
    const toStatus = action === "postpone" ? "postponed" : "active";

    if (event.status === toStatus) {
      return json(
        { ok: true, eventId, status: toStatus, already: true },
        200,
        req,
      );
    }
    if (event.status !== fromStatus) {
      return json(
        {
          ok: false,
          error: {
            message:
              action === "postpone"
                ? `Only an active event can be postponed (current: ${event.status})`
                : `Only a postponed event can be resumed (current: ${event.status})`,
          },
        },
        409,
        req,
      );
    }

    // Guarded transition — a concurrent cancel/postpone resolves to
    // exactly one winner; 0 rows updated means we lost the race.
    const { data: updated, error: updateErr } = await supabase
      .from("events")
      .update({ status: toStatus })
      .eq("id", eventId)
      .eq("status", fromStatus)
      .select("id");
    if (updateErr) {
      console.error("[event-postpone] transition failed:", updateErr);
      return json(
        { ok: false, error: { message: "Failed to update event" } },
        500,
        req,
      );
    }
    if (!updated || updated.length === 0) {
      return json(
        {
          ok: false,
          error: { message: "Event changed state — reload and retry" },
        },
        409,
        req,
      );
    }

    const title =
      action === "postpone" ? "Event postponed" : "Event back on";
    const messageBody =
      action === "postpone"
        ? `${event.title || "This event"} has been postponed by the host.` +
          (note ? `\n\n${note}` : "") +
          `\n\nYour ticket remains valid — we'll notify you when the new date is set. No action is needed.`
        : `${event.title || "This event"} is back on.` +
          (note ? `\n\n${note}` : "") +
          `\n\nYour ticket is valid as issued.`;

    // ── Attendee push + in-app (best-effort) ──────────────────────────
    // 'event_changed' is the closest enum_notifications_type value —
    // 'event_postponed' would need an enum migration.
    let notified = 0;
    let pushed = 0;
    const { data: openTickets } = await supabase
      .from("tickets")
      .select("user_id, guest_email, status")
      .eq("event_id", eventId)
      .in("status", ["active", "transfer_pending", "scanned"]);
    try {
      const affectedAuthIds = Array.from(
        new Set(
          (openTickets || [])
            .map((t: any) => t.user_id)
            .filter((id: any) => id && id !== authId) as string[],
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
              type: "event_changed",
              entity_type: "event",
              entity_id: String(eventId),
              entity_payload: {
                title: `${event.title || "Event"}: ${title.toLowerCase()}`,
                body:
                  action === "postpone"
                    ? "Postponed by the host — your ticket remains valid."
                    : "The event is back on — your ticket is valid as issued.",
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
              title: `${event.title || "Event"}: ${title}`,
              body:
                action === "postpone"
                  ? "Your ticket remains valid. We'll let you know the new date."
                  : "Your ticket is valid as issued.",
              data: {
                type: "event_changed",
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
            pushed = tokens.length;
          }
        }
      }
    } catch (notifyErr) {
      console.warn("[event-postpone] notify failed (non-fatal):", notifyErr);
    }

    // ── Guest emails (best-effort, deduped by address) ────────────────
    let guestEmailsSent = 0;
    try {
      const guestEmails = new Set<string>();
      for (const t of openTickets || []) {
        if (!t.user_id && t.guest_email) guestEmails.add(t.guest_email);
      }
      const { data: guestOrders } = await supabase
        .from("orders")
        .select("guest_email")
        .eq("event_id", eventId)
        .eq("type", "event_ticket")
        .in("status", ["paid", "partially_refunded"])
        .not("guest_email", "is", null);
      for (const o of guestOrders || []) {
        if (o.guest_email) guestEmails.add(o.guest_email);
      }

      const content = broadcast({
        eventTitle: event.title || "Your event",
        message: messageBody,
        flyerUrl: event.flyer_image_url || event.cover_image_url || null,
        dominantColor: event.dominant_color || null,
        ctaUrl: `https://dvntapp.live/e/${eventId}`,
        ctaLabel: "View event",
      });
      for (const email of guestEmails) {
        try {
          await sendResendEmail({ to: email, ...content });
          guestEmailsSent++;
        } catch (mailErr) {
          console.warn("[event-postpone] guest email failed:", mailErr);
        }
      }
    } catch (guestErr) {
      console.warn("[event-postpone] guest sweep failed:", guestErr);
    }

    return json(
      {
        ok: true,
        eventId,
        status: toStatus,
        action,
        notified,
        pushed,
        guestEmailsSent,
      },
      200,
      req,
    );
  } catch (err: any) {
    console.error("[event-postpone] Unexpected:", err);
    return json(
      { ok: false, error: { message: err?.message || "Internal error" } },
      500,
      req,
    );
  }
});
