/**
 * Edge Function: toggle-event-like
 * Toggle like on an event with Better Auth verification.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { withRetry } from "../_shared/with-retry.ts";
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
  console.error(`[Edge:toggle-event-like] Error: ${code} - ${message}`);
  return jsonResponse(req, { ok: false, error: { code, message } }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return optionsResponse();
  }

  if (req.method !== "POST") {
    return errorResponse(req, "validation_error", "Method not allowed", 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse(
        req,
        "internal_error",
        "Server configuration error",
        500,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    const authUserId = await verifySession(supabaseAdmin, req);
    if (!authUserId) {
      return errorResponse(req, "unauthorized", "Invalid or expired session");
    }

    const rl = checkRateLimit(authUserId, "toggle-event-like", WRITE_LIMIT);
    if (!rl.allowed) {
      return errorResponse(
        req,
        "rate_limited",
        "Too many requests. Try again shortly.",
      );
    }

    let body: { eventId?: number };
    try {
      body = await req.json();
    } catch {
      return errorResponse(req, "validation_error", "Invalid JSON body", 400);
    }

    const eventId = body.eventId;
    if (!eventId || typeof eventId !== "number") {
      return errorResponse(
        req,
        "validation_error",
        "eventId is required and must be a number",
        400,
      );
    }

    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id",
    );
    if (!userData?.id) {
      return errorResponse(req, "not_found", "User not found");
    }

    const userId = userData.id;

    const { data: existingLike } = await withRetry(
      () =>
        supabaseAdmin
          .from("event_likes")
          .select("id")
          .eq("user_id", userId)
          .eq("event_id", eventId)
          .maybeSingle(),
      { label: "toggle-event-like:check" },
    );

    let liked = false;

    if (existingLike?.id) {
      const { error: deleteError } = await withRetry(
        () =>
          supabaseAdmin
            .from("event_likes")
            .delete()
            .eq("user_id", userId)
            .eq("event_id", eventId),
        { label: "toggle-event-like:delete" },
      );

      if (deleteError) {
        console.error("[Edge:toggle-event-like] Delete error:", deleteError);
        return errorResponse(req, "internal_error", "Failed to unlike");
      }
    } else {
      const { error: insertError } = await withRetry(
        () =>
          supabaseAdmin.from("event_likes").insert({
            user_id: userId,
            event_id: eventId,
          }),
        { label: "toggle-event-like:insert" },
      );

      if (insertError) {
        console.error("[Edge:toggle-event-like] Insert error:", insertError);
        return errorResponse(req, "internal_error", "Failed to like");
      }

      liked = true;
    }

    const { count, error: countError } = await withRetry(
      () =>
        supabaseAdmin
          .from("event_likes")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId),
      { label: "toggle-event-like:count" },
    );

    if (countError) {
      console.error("[Edge:toggle-event-like] Count error:", countError);
      return errorResponse(req, "internal_error", "Failed to load likes");
    }

    return jsonResponse(req, {
      ok: true,
      data: {
        liked,
        likesCount: count ?? 0,
      },
    });
  } catch (error) {
    console.error("[Edge:toggle-event-like] Unexpected error:", error);
    return errorResponse(req, "internal_error", "Unexpected server error", 500);
  }
});
