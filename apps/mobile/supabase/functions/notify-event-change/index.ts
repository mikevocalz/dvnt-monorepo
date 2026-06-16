/**
 * notify-event-change Edge Function
 *
 * POST /notify-event-change
 * Body: {
 *   eventId: number,
 *   changes: ('start_date' | 'end_date' | 'location' | 'age_restriction')[],
 *   summary?: string,  // optional one-line human summary; we synthesize one if absent
 * }
 *
 * Host-only. Pushes a "material change" notification to every active
 * ticket holder + every "going" RSVP for the event. Body is the diff
 * the host just saved (date / venue / age restriction) — the kind of
 * change that affects an attendee's plan and historically created
 * trust blow-back ("event moved to Saturday — nobody told me").
 *
 * Best-effort: failures are logged but the calling save flow is NOT
 * blocked. Mirror the cancel-event notification pattern.
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

const VALID_CHANGES = new Set([
  "start_date",
  "end_date",
  "location",
  "age_restriction",
]);

function synthesizeSummary(
  changes: string[],
  eventTitle: string,
  newStart?: string | null,
  newLocation?: string | null,
): string {
  if (changes.includes("start_date") && newStart) {
    try {
      const d = new Date(newStart);
      const formatted = d.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      return `${eventTitle} moved to ${formatted}.`;
    } catch {
      return `${eventTitle}: date changed.`;
    }
  }
  if (changes.includes("location") && newLocation) {
    return `${eventTitle} moved to ${newLocation}.`;
  }
  if (changes.includes("age_restriction")) {
    return `${eventTitle}: age requirement updated.`;
  }
  if (changes.includes("end_date")) {
    return `${eventTitle}: end time changed.`;
  }
  return `${eventTitle}: details updated.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST")
    return json({ error: "Method not allowed" }, 405, req);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return json({ error: "Unauthorized" }, 401, req);

    const rl = checkRateLimit(authId, "notify-event-change", {
      maxRequests: 10,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return json({ error: "Too many notification requests" }, 429, req);
    }

    let body: {
      eventId?: number;
      changes?: string[];
      summary?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, req);
    }

    const eventId = Number(body.eventId);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return json({ error: "eventId required" }, 400, req);
    }
    const changes = (body.changes || []).filter((c) => VALID_CHANGES.has(c));
    if (changes.length === 0) {
      return json({ error: "no material changes" }, 400, req);
    }

    // Verify ownership
    const { data: event } = await supabase
      .from("events")
      .select("id, host_id, title, start_date, location_name, location, status")
      .eq("id", eventId)
      .maybeSingle();
    if (!event) return json({ error: "Event not found" }, 404, req);
    if (String(event.host_id) !== String(authId)) {
      return json({ error: "Not your event" }, 403, req);
    }
    if (event.status === "cancelled") {
      return json({ ok: true, skipped: "cancelled" }, 200, req);
    }

    const summary =
      (typeof body.summary === "string" && body.summary.trim().slice(0, 200)) ||
      synthesizeSummary(
        changes,
        event.title || "Your event",
        event.start_date,
        event.location_name || event.location,
      );

    // Collect every user who needs to be notified: active/transfer_pending
    // ticket holders + going RSVPs (deduped).
    const [{ data: ticketHolders }, { data: rsvpHolders }] = await Promise.all([
      supabase
        .from("tickets")
        .select("user_id")
        .eq("event_id", eventId)
        .in("status", ["active", "transfer_pending", "scanned"]),
      supabase
        .from("event_rsvps")
        .select("user_id")
        .eq("event_id", eventId)
        .eq("status", "going"),
    ]);

    const authIdSet = new Set<string>();
    for (const t of ticketHolders || []) {
      if (t.user_id && t.user_id !== authId) authIdSet.add(t.user_id);
    }
    for (const r of rsvpHolders || []) {
      if (r.user_id && r.user_id !== authId) authIdSet.add(r.user_id);
    }
    const affectedAuthIds = Array.from(authIdSet);
    if (affectedAuthIds.length === 0) {
      return json({ ok: true, notified: 0 }, 200, req);
    }

    // auth_id → integer user.id (push_tokens + notifications use int)
    const { data: userRows } = await supabase
      .from("users")
      .select("id, auth_id")
      .in("auth_id", affectedAuthIds);
    const intIds = (userRows || []).map((r: any) => r.id);
    if (intIds.length === 0) {
      return json({ ok: true, notified: 0 }, 200, req);
    }

    // In-app feed entries
    await supabase.from("notifications").insert(
      intIds.map((uid: number) => ({
        recipient_id: uid,
        actor_id: null,
        type: "event_changed",
        entity_type: "event",
        entity_id: String(eventId),
        entity_payload: { summary, changes },
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
        title: "Event details changed",
        body: summary,
        data: {
          type: "event_changed",
          entityType: "event",
          entityId: String(eventId),
          changes,
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
        console.warn("[notify-event-change] push failed:", pushErr);
      }
    }

    return json(
      {
        ok: true,
        notified: intIds.length,
        pushed,
        summary,
        changes,
      },
      200,
      req,
    );
  } catch (err: any) {
    console.error("[notify-event-change] Unexpected:", err);
    return json({ error: err.message || "Internal error" }, 500, req);
  }
});
