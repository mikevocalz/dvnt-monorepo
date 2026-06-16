/**
 * event-broadcast-message Edge Function
 *
 * POST /event-broadcast-message
 * Body: {
 *   event_id: number,
 *   title?: string,           // optional, defaults to event title
 *   body: string,             // required, 1..400 chars
 *   audience?: "all" | "scanned" | "unscanned",
 * }
 *
 * Owner or accepted admin co-organizer only. Editors and scanners are
 * denied because broadcasts are a high-trust capability (spam vector).
 *
 * Sends an in-app notification + Expo push to every distinct attendee
 * matching the audience filter. The sender is NOT included as a
 * recipient. Returns { ok, notified, pushed }.
 *
 * Rate limited to 3 per 5 minutes per (sender, event) so a panicked
 * host can't accidentally page everyone five times.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

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
      event_id?: number | string;
      title?: string;
      body?: string;
      audience?: string;
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

    const eventId = Number(body.event_id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return json(
        { ok: false, error: { message: "event_id required" } },
        400,
        req,
      );
    }

    const message =
      typeof body.body === "string" ? body.body.trim().slice(0, 400) : "";
    if (!message) {
      return json(
        { ok: false, error: { message: "Message body required" } },
        400,
        req,
      );
    }

    const audience: "all" | "scanned" | "unscanned" =
      body.audience === "scanned"
        ? "scanned"
        : body.audience === "unscanned"
          ? "unscanned"
          : "all";

    // Permission: owner or accepted admin only.
    const { data: event } = await supabase
      .from("events")
      .select("id, host_id, title, status")
      .eq("id", eventId)
      .maybeSingle();
    if (!event)
      return json(
        { ok: false, error: { message: "Event not found" } },
        404,
        req,
      );
    if (event.status === "cancelled") {
      return json(
        {
          ok: false,
          error: {
            message:
              "Event is cancelled. Broadcast disabled to avoid confusion.",
          },
        },
        409,
        req,
      );
    }

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
                "Only the event owner or an admin co-organizer can broadcast",
            },
          },
          403,
          req,
        );
      }
    }

    const rl = checkRateLimit(authId, `broadcast:${eventId}`, {
      maxRequests: 3,
      windowMs: 5 * 60_000,
    });
    if (!rl.allowed) {
      return json(
        {
          ok: false,
          error: {
            message: "Too many broadcasts. Wait a few minutes and try again.",
          },
        },
        429,
        req,
      );
    }

    // Collect attendee auth_ids based on audience.
    let ticketsQuery = supabase
      .from("tickets")
      .select("user_id, status")
      .eq("event_id", eventId);
    if (audience === "scanned") {
      ticketsQuery = ticketsQuery.eq("status", "scanned");
    } else if (audience === "unscanned") {
      ticketsQuery = ticketsQuery.in("status", ["active", "transfer_pending"]);
    } else {
      ticketsQuery = ticketsQuery.in("status", [
        "active",
        "transfer_pending",
        "scanned",
      ]);
    }
    const { data: ticketHolders } = await ticketsQuery;

    const authIdSet = new Set<string>();
    for (const t of ticketHolders || []) {
      if (t.user_id && t.user_id !== authId) authIdSet.add(t.user_id);
    }
    const affectedAuthIds = Array.from(authIdSet);
    if (affectedAuthIds.length === 0) {
      return json({ ok: true, data: { notified: 0, pushed: 0 } }, 200, req);
    }

    // auth_id → integer user.id (push_tokens + notifications use int)
    const { data: userRows } = await supabase
      .from("users")
      .select("id, auth_id")
      .in("auth_id", affectedAuthIds);
    const intIds = (userRows || []).map((r: any) => r.id);
    if (intIds.length === 0) {
      return json({ ok: true, data: { notified: 0, pushed: 0 } }, 200, req);
    }

    // Persist for the in-app activity feed. message body goes in
    // entity_payload so the activity row can render it inline.
    await supabase.from("notifications").insert(
      intIds.map((uid: number) => ({
        recipient_id: uid,
        actor_id: null,
        type: "event_broadcast",
        entity_type: "event",
        entity_id: String(eventId),
        entity_payload: {
          title: body.title || event.title || "Event update",
          body: message,
        },
      })),
    );

    // Push
    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token, user_id")
      .in("user_id", intIds);

    let pushed = 0;
    if (tokens && tokens.length > 0) {
      const messages = tokens.map((t: any) => ({
        to: t.token,
        title: body.title || event.title || "Event update",
        body: message,
        // Selects the DVNT custom long-look on Apple Watch (→ APNs aps.category).
        // Harmless on Android / older iOS, which ignore an unknown category.
        categoryId: "dvnt_broadcast",
        data: {
          type: "event_broadcast",
          entityType: "event",
          entityId: String(eventId),
          // Lets the watch long-look show the event name without a lookup.
          entityTitle: event.title || body.title || "Event update",
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
        pushed = tokens.length;
      } catch (pushErr) {
        console.warn("[event-broadcast-message] push failed:", pushErr);
      }
    }

    return json(
      {
        ok: true,
        data: { notified: intIds.length, pushed, audience },
      },
      200,
      req,
    );
  } catch (err: any) {
    console.error("[event-broadcast-message] Unexpected:", err);
    return json(
      { ok: false, error: { message: err?.message || "Internal error" } },
      500,
      req,
    );
  }
});
