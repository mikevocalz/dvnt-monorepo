/**
 * Edge Function: create-event
 * Creates an event with Better Auth verification and service-role DB writes.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit, WRITE_LIMIT } from "../_shared/rate-limit.ts";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function jsonResponse<T>(
  req: Request,
  data: ApiResponse<T>,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function errorResponse(
  req: Request,
  code: string,
  message: string,
  status = 200,
): Response {
  console.error(`[Edge:create-event] Error: ${code} - ${message}`);
  return jsonResponse(req, { ok: false, error: { code, message } }, status);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Media URL guard: only hosted http(s) URLs may persist. blob:/data:/file:
 * URLs are browser/device-local — dead for every other viewer (this is how
 * events ended up with broken flyers). Null them instead of storing garbage.
 */
function hostedUrl(value: unknown): string | null {
  const t = text(value);
  return t && /^https?:\/\//i.test(t) ? t : null;
}

function textList(value: unknown): string | null {
  if (Array.isArray(value)) {
    const lines = value
      .filter((v) => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : null;
  }
  return text(value);
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeVisibility(value: unknown): "public" | "private" | "link_only" {
  if (value === "private" || value === "link_only" || value === "public") {
    return value;
  }
  if (value === "unlisted") return "link_only";
  return "public";
}

function normalizeCategory(value: unknown):
  | "music"
  | "sports"
  | "art"
  | "food"
  | "tech"
  | "business"
  | "health"
  | "other"
  | null {
  const v = text(value);
  if (
    v === "music" ||
    v === "sports" ||
    v === "art" ||
    v === "food" ||
    v === "tech" ||
    v === "business" ||
    v === "health" ||
    v === "other"
  ) {
    return v;
  }
  return v ? "other" : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return errorResponse(req, "validation_error", "Method not allowed", 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse(req, "internal_error", "Server configuration error", 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    const authUserId = await verifySession(supabaseAdmin, req);
    if (!authUserId) {
      return errorResponse(req, "unauthorized", "Invalid or expired session", 401);
    }

    const rl = checkRateLimit(authUserId, "create-event", WRITE_LIMIT);
    if (!rl.allowed) {
      return errorResponse(
        req,
        "rate_limited",
        "Too many requests. Try again shortly.",
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse(req, "validation_error", "Invalid JSON body", 400);
    }

    const title = text(body.title);
    const startDate = text(body.date) || text(body.startDate);
    const location = text(body.location);
    if (!title) return errorResponse(req, "validation_error", "Title is required");
    if (!startDate || Number.isNaN(new Date(startDate).getTime())) {
      return errorResponse(req, "validation_error", "Valid start date is required");
    }
    if (!location) {
      return errorResponse(req, "validation_error", "Location is required");
    }

    const coverImageUrl = hostedUrl(body.image) || hostedUrl(body.coverImageUrl);
    const maxAttendees = finiteNumber(body.maxAttendees);
    const price = finiteNumber(body.price);
    const locationLat = finiteNumber(body.locationLat);
    const locationLng = finiteNumber(body.locationLng);
    const ageRestriction = text(body.ageRestriction);
    const locationType = text(body.locationType);

    const insertPayload: Record<string, unknown> = {
      host_id: authUserId,
      title,
      description: text(body.description) || "",
      start_date: startDate,
      location,
      cover_image_url: coverImageUrl,
      image: coverImageUrl,
      images: Array.isArray(body.images)
        ? body.images.filter(
            (m: unknown) =>
              typeof (m as { url?: unknown })?.url === "string" &&
              /^https?:\/\//i.test((m as { url: string }).url),
          )
        : [],
      youtube_video_url: text(body.youtubeVideoUrl),
      price: price != null && price >= 0 ? price : 0,
      is_online: body.isOnline === true,
      visibility: normalizeVisibility(body.visibility),
      status: "active",
    };

    if (maxAttendees != null && maxAttendees > 0) {
      insertPayload.max_attendees = Math.floor(maxAttendees);
    }
    if (locationLat != null) insertPayload.location_lat = locationLat;
    if (locationLng != null) insertPayload.location_lng = locationLng;
    if (text(body.locationName)) insertPayload.location_name = text(body.locationName);
    if (text(body.locationAddress)) insertPayload.location_address = text(body.locationAddress);
    if (locationType === "virtual" || locationType === "physical") {
      insertPayload.location_type = locationType;
    }
    const category = normalizeCategory(
      text(body.event_type) || text(body.category) || text(body.eventCategory),
    );
    if (category) insertPayload.category = category;
    if (ageRestriction === "18+" || ageRestriction === "21+" || ageRestriction === "none") {
      insertPayload.age_restriction = ageRestriction;
    }
    if (text(body.endDate)) insertPayload.end_date = text(body.endDate);
    if (typeof body.ticketingEnabled === "boolean") {
      insertPayload.ticketing_enabled = body.ticketingEnabled;
    }
    if (text(body.dressCode)) insertPayload.dress_code = text(body.dressCode);
    if (text(body.doorPolicy)) insertPayload.door_policy = text(body.doorPolicy);
    if (textList(body.lineup)) insertPayload.lineup = textList(body.lineup);
    if (textList(body.perks)) insertPayload.perks = textList(body.perks);
    if (text(body.disclaimers)) insertPayload.disclaimers = text(body.disclaimers);
    if (hostedUrl(body.flyerImageUrl)) insertPayload.flyer_image_url = hostedUrl(body.flyerImageUrl);
    if (hostedUrl(body.videoFlyerUrl)) insertPayload.video_flyer_url = hostedUrl(body.videoFlyerUrl);
    if (typeof body.nsfw === "boolean") insertPayload.nsfw = body.nsfw;

    const { data: event, error } = await supabaseAdmin
      .from("events")
      .insert(insertPayload)
      .select()
      .single();

    if (error || !event) {
      console.error("[Edge:create-event] insert error:", error);
      return errorResponse(
        req,
        "internal_error",
        error?.message || "Failed to create event",
        500,
      );
    }

    return jsonResponse(req, { ok: true, data: { event } });
  } catch (err) {
    console.error("[Edge:create-event] unexpected:", err);
    return errorResponse(req, "internal_error", "Unexpected server error", 500);
  }
});
