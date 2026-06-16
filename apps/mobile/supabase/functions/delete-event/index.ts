/**
 * Edge Function: delete-event
 * Delete an event with Better Auth verification + CDN cleanup
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string): Response {
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST")
    return errorResponse("validation_error", "Method not allowed");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer "))
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
        401,
      );

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error", 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via direct DB lookup
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !sessionData) {
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    if (new Date(sessionData.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }

    const authUserId = sessionData.userId;

    let body: { eventId: number };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { eventId } = body;
    if (!eventId)
      return errorResponse("validation_error", "eventId is required");

    console.log("[Edge:delete-event] eventId:", eventId, "user:", authUserId);

    // Look up the app user row (auto-provision if needed)
    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id, auth_id",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    // Fetch the event
    const { data: event, error: fetchError } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (fetchError || !event)
      return errorResponse("not_found", "Event not found");

    // Verify ownership: host_id could be auth_id (string) or user id (integer as string)
    const hostId = String(event.host_id);
    const isOwner =
      hostId === authUserId ||
      hostId === String(userData.id) ||
      hostId === String(userData.auth_id);

    if (!isOwner) {
      console.error(
        "[Edge:delete-event] Ownership mismatch — hostId:",
        hostId,
        "authId:",
        authUserId,
        "userId:",
        userData.id,
      );
      return errorResponse(
        "forbidden",
        "You are not the host of this event",
        403,
      );
    }

    // V2-EVT-01 guard: refuse hard-delete when ANY ticket exists for
    // this event in a non-terminal state. Hard-deleting an event with
    // active tickets orphans the rows + leaves Stripe charges with no
    // refund path. Hosts must use cancel-event instead, which cascades
    // refunds + notifies attendees.
    const { data: nonTerminalTickets, count: nonTerminalCount } =
      await supabaseAdmin
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .in("status", ["active", "transfer_pending", "scanned"]);
    if ((nonTerminalCount ?? nonTerminalTickets?.length ?? 0) > 0) {
      return errorResponse(
        "tickets_exist",
        "This event has active tickets. Use Cancel Event instead — it will refund attendees and notify them.",
        409,
      );
    }

    // Delete related records (best-effort, in case FK cascade is missing)
    const relatedDeletes = [
      supabaseAdmin.from("event_rsvps").delete().eq("event_id", eventId),
      supabaseAdmin.from("event_likes").delete().eq("event_id", eventId),
      supabaseAdmin.from("event_comments").delete().eq("event_id", eventId),
      supabaseAdmin.from("event_reviews").delete().eq("event_id", eventId),
    ];

    const results = await Promise.allSettled(relatedDeletes);
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.warn(
          `[Edge:delete-event] related delete ${i} failed:`,
          r.reason,
        );
      } else if (r.status === "fulfilled" && r.value?.error) {
        // Table might not exist yet — that's OK
        console.warn(
          `[Edge:delete-event] related delete ${i} DB error:`,
          r.value.error.message,
        );
      }
    });

    // Delete the event itself
    const { error: deleteError } = await supabaseAdmin
      .from("events")
      .delete()
      .eq("id", eventId);

    if (deleteError) {
      console.error("[Edge:delete-event] Delete error:", deleteError);
      return errorResponse("internal_error", "Failed to delete event");
    }

    console.log("[Edge:delete-event] Success — eventId:", eventId);

    return jsonResponse({ ok: true, data: { success: true } });
  } catch (err) {
    console.error("[Edge:delete-event] Error:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
