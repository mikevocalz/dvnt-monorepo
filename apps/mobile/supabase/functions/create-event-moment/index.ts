/**
 * Edge Function: create-event-moment
 * Save a "Who All Over There" moment (photo or ≤30s video) for an event.
 * Only ticket holders and hosts/co-hosts may upload.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { checkRateLimit, WRITE_LIMIT } from "../_shared/rate-limit.ts";

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceKey) return json(req, { ok: false, error: "Server config error" }, 500);

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${serviceKey}` } },
  });

  const authUserId = await verifySession(db, req);
  if (!authUserId) return json(req, { ok: false, error: "Unauthorized" }, 401);

  const rl = checkRateLimit(authUserId, "create-event-moment", WRITE_LIMIT);
  if (!rl.allowed) return json(req, { ok: false, error: "Rate limited" }, 429);

  let body: { eventId?: number; mediaUrl?: string; mediaType?: string; durationSec?: number; thumbnailUrl?: string };
  try { body = await req.json(); } catch { return json(req, { ok: false, error: "Invalid body" }, 400); }

  const { eventId, mediaUrl, mediaType, durationSec, thumbnailUrl } = body;
  if (!eventId || !mediaUrl || !mediaType) return json(req, { ok: false, error: "Missing fields" }, 400);
  if (!["photo", "video"].includes(mediaType)) return json(req, { ok: false, error: "Invalid mediaType" }, 400);
  if (mediaType === "video" && durationSec != null && durationSec > 31) {
    return json(req, { ok: false, error: "Video must be ≤30 seconds" }, 400);
  }

  const userData = await resolveOrProvisionUser(db, authUserId, "id");
  if (!userData?.id) return json(req, { ok: false, error: "User not found" }, 404);
  const userId = userData.id as number;

  // Fetch event to get host_id and end_date
  const { data: event } = await db
    .from("events")
    .select("host_id, end_date, start_date")
    .eq("id", eventId)
    .maybeSingle();

  if (!event) return json(req, { ok: false, error: "Event not found" }, 404);

  // Check permission: host OR ticket holder OR co-organizer
  const isHost = event.host_id === authUserId;
  let canUpload = isHost;

  if (!canUpload) {
    const { data: ticket } = await db
      .from("tickets")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", authUserId)
      .eq("status", "active")
      .maybeSingle();
    canUpload = !!ticket;
  }

  if (!canUpload) {
    const { data: coOrg } = await db
      .from("event_co_organizers")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", authUserId)
      .eq("accepted", true)
      .maybeSingle();
    canUpload = !!coOrg;
  }

  if (!canUpload) return json(req, { ok: false, error: "Only ticket holders and hosts may post moments" }, 403);

  // Expires 24h after event end (or 48h from now if no end_date)
  const eventEnd = event.end_date || event.start_date;
  const expiresAt = eventEnd
    ? new Date(new Date(eventEnd).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  // Build insert payload; thumbnail_url is optional (column may not exist on older DBs)
  const insertPayload: Record<string, unknown> = {
    event_id: eventId,
    user_id: userId,
    media_url: mediaUrl,
    media_type: mediaType,
    duration_sec: durationSec ?? null,
    expires_at: expiresAt,
  };
  if (thumbnailUrl) insertPayload.thumbnail_url = thumbnailUrl;

  const { data: moment, error: insertErr } = await db
    .from("event_moments")
    .insert(insertPayload)
    .select("id, media_url, media_type, duration_sec, expires_at, created_at")
    .single();

  if (insertErr) {
    console.error("[create-event-moment] insert error:", insertErr);
    return json(req, { ok: false, error: "Failed to save moment" }, 500);
  }

  return json(req, { ok: true, data: moment });
});
