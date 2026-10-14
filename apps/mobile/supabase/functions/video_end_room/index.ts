/**
 * Edge Function: video_end_room
 * Ends a video room (host only)
 * Persists the authoritative end before best-effort legacy media cleanup
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EndRoomSchema = z.object({
  roomId: z.string().uuid(),
});

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "internal_error";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: ErrorCode; message: string };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: ErrorCode, message: string): Response {
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const fishjamAppId = Deno.env.get("FISHJAM_APP_ID")!;
    const fishjamApiKey = Deno.env.get("FISHJAM_API_KEY")!;
    const fishjamBaseUrl = `https://fishjam.io/api/v1/connect/${fishjamAppId}`;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via shared helper
    const sessionResult = await verifySessionDetailed(supabase, req);
    if (!sessionResult.ok) {
      if (sessionResult.reason === "expired") {
        return errorResponse("unauthorized", "Session expired");
      }
      return errorResponse("unauthorized", "Invalid or expired session");
    }

    const actorAuthId = sessionResult.userId;

    // Get the user's integer ID for room membership checks
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", actorAuthId)
      .single();

    if (userError || !userData) {
      return errorResponse("not_found", "User not found");
    }

    const actorId = actorAuthId;

    // Parse input
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const parsed = EndRoomSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "validation_error",
        parsed.error.errors[0].message,
      );
    }

    const { roomId } = parsed.data;

    // Check room exists — look up by uuid (what video_create_room returns)
    const { data: room, error: roomError } = await supabase
      .from("video_rooms")
      .select("*")
      .eq("uuid", roomId)
      .single();

    if (roomError || !room) {
      return errorResponse("not_found", "Room not found");
    }

    const internalRoomId = room.id;

    // Authorize before even the idempotent response. The active-role RPC returns
    // null after the first end changes memberships to left; the original room
    // creator may retry cleanup for that already-ended room.
    const { data: actorRole, error: roleError } = await supabase.rpc("get_user_room_role", {
      p_user_id: actorId,
      p_room_id: internalRoomId,
    });
    if (roleError) return errorResponse("internal_error", "Could not verify host role");
    if (actorRole !== "host") {
      if (room.created_by !== actorId) {
        return errorResponse("forbidden", "Only the host can end the room");
      }
      if (room.status !== "ended") {
        // A concurrent end can remove active membership after our first read.
        // Permit only a confirmed already-ended creator retry, never an inactive
        // creator ending a still-open room without the host role.
        const { data: retryRoom, error: retryError } = await supabase
          .from("video_rooms")
          .select("status, ended_at")
          .eq("id", internalRoomId)
          .maybeSingle();
        if (retryError) return errorResponse("internal_error", "Could not verify room end");
        if (retryRoom?.status !== "ended") return errorResponse("forbidden", "Only the host can end the room");
        room.status = retryRoom.status;
        room.ended_at = retryRoom.ended_at;
      }
    }

    // Schema: 20260213100001_video_rooms_schema.sql allows open/closed/ended.
    // Only open admits media, but a host may finalize a closed legacy room too.
    if (!["open", "closed", "ended"].includes(room.status)) {
      return errorResponse("conflict", "Room status cannot be ended safely");
    }

    // 1. Persist the terminal state FIRST. No legacy relay outage may delay the
    // row watched by web/native clients or allow fresh MoQ credentials to mint.
    // The conditional update also elects one caller to emit the end event.
    let endedAt = room.ended_at ?? new Date().toISOString();
    let didEnd = false;
    if (room.status !== "ended") {
      const { data: changedRoom, error: updateError } = await supabase
        .from("video_rooms")
        .update({ status: "ended", ended_at: endedAt, participant_count: 0 })
        .eq("id", internalRoomId)
        .eq("status", room.status)
        .select("id, ended_at")
        .maybeSingle();
      if (updateError) {
        console.error("[video_end_room] Room update error:", updateError.message);
        return errorResponse("internal_error", "Failed to end room");
      }
      didEnd = !!changedRoom;
      if (!didEnd) {
        // Another authorized end may have won. Never claim success merely
        // because the conditional update affected zero rows.
        const { data: currentRoom, error: currentError } = await supabase
          .from("video_rooms")
          .select("status, ended_at")
          .eq("id", internalRoomId)
          .maybeSingle();
        if (currentError || currentRoom?.status !== "ended") {
          return errorResponse("internal_error", "Could not confirm room end");
        }
        endedAt = currentRoom.ended_at ?? endedAt;
      }
    }

    // The room is already ended even if ancillary cleanup fails. Report that
    // distinction honestly and attempt every step; never reopen or return a
    // generic "failed to end" after committing the authoritative terminal row.
    const cleanupWarnings: string[] = [];
    async function cleanupStep(name: string, run: () => PromiseLike<{ error: unknown }>) {
      try {
        const { error } = await run();
        if (error) throw error;
      } catch (error) {
        cleanupWarnings.push(name);
        console.error(`[video_end_room] ${name}:`, error);
      }
    }

    // 2. Idempotent active-membership and unrevoked-token cleanup.
    await cleanupStep("members_not_updated", () => supabase
      .from("video_room_members")
      .update({ status: "left", left_at: endedAt, hand_raised: false })
      .eq("room_id", internalRoomId)
      .eq("status", "active"));
    await cleanupStep("tokens_not_revoked", () => supabase
      .from("video_room_tokens")
      .update({ revoked_at: endedAt })
      .eq("room_id", internalRoomId)
      .is("revoked_at", null));

    // 3. Only the transition winner emits. Repeated requests must not create
    // duplicate room-ended notifications; the persisted room row is sufficient
    // for clients even if this supplementary event write fails.
    if (didEnd) {
      await cleanupStep("room_event_not_recorded", () => supabase
        .from("video_room_events")
        .insert({ room_id: internalRoomId, type: "room_ended", actor_id: actorId, payload: { endedAt } }));
    } else {
      await cleanupStep("room_event_not_confirmed", async () => {
        const { data: event, error } = await supabase
          .from("video_room_events")
          .select("id")
          .eq("room_id", internalRoomId)
          .eq("type", "room_ended")
          .limit(1)
          .maybeSingle();
        return { error: error ?? (event ? null : new Error("Room end event is missing or still pending")) };
      });
    }

    // 4. Legacy Fishjam cleanup is LAST and bounded. It does not revoke MoQ
    // access; never wait indefinitely for this unrelated transport's DELETE.
    if (room.fishjam_room_id) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Legacy room deletion timed out"));
          }, 2_000);
        });
        const result = await Promise.race([
          fetch(`${fishjamBaseUrl}/room/${room.fishjam_room_id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${fishjamApiKey}` },
            signal: controller.signal,
          }),
          timeout,
        ]);
        if (!result.ok && result.status !== 404) throw new Error(`Legacy room deletion returned ${result.status}`);
      } catch (error) {
        cleanupWarnings.push("legacy_media_cleanup_failed");
        console.error("[video_end_room] Legacy room deletion failed:", error);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }

    console.log(`[video_end_room] Room ${roomId} ended by ${actorId}`);

    return jsonResponse({
      ok: true,
      data: {
        ended: true,
        roomId,
        alreadyEnded: !didEnd,
        cleanupComplete: cleanupWarnings.length === 0,
        ...(cleanupWarnings.length ? { cleanupWarnings } : {}),
      },
    });
  } catch (err) {
    console.error("[video_end_room] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
