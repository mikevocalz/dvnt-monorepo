/**
 * Edge Function: call_create
 * WS-1: personal Calls, split from Sneaky Lynk rooms.
 *
 * Thin wrapper — resolves participantIds (integer users.id, matching
 * call_signals.caller_id/callee_id) to auth_id, then forwards to
 * video_create_room verbatim (same rate limits, subscription caps, invite
 * rows, notifications) so the two stacks share one implementation. Stamps
 * room_kind='call' on the created row afterward since video_create_room
 * doesn't know about the discriminator.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CallCreateSchema = z.object({
  title: z.string().min(1).max(100),
  participantIds: z.array(z.string().min(1)).min(1).max(50),
  hasVideo: z.boolean().default(true),
  maxParticipants: z.number().int().min(2).max(50).default(10),
});

type ErrorCode =
  | "unauthorized"
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
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    const sessionResult = await verifySessionDetailed(supabase, req);
    if (!sessionResult.ok) {
      return errorResponse(
        "unauthorized",
        sessionResult.reason === "expired"
          ? "Session expired"
          : "Invalid or expired session",
      );
    }
    const userId = sessionResult.userId; // caller's auth_id

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const parsed = CallCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("validation_error", parsed.error.errors[0].message);
    }
    const { title, participantIds, hasVideo, maxParticipants } = parsed.data;

    // call_signals.caller_id/callee_id and chat participantIds are integer
    // users.id as text (verified live 2026-08-12), NOT auth_id — resolve via
    // the users table so video_room_invites (which is keyed by auth_id, same
    // as video_rooms.created_by) actually grants the callee access. Without
    // this resolution a callee has no invite row and can never pass
    // video_join_room's private-room gate.
    const numericIds = participantIds
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n));

    const { data: calleeRows, error: calleeErr } = await supabase
      .from("users")
      .select("id, auth_id")
      .in("id", numericIds);

    if (calleeErr) {
      console.error("[call_create] Participant lookup error:", calleeErr.message);
      return errorResponse("internal_error", "Failed to resolve participants");
    }

    const inviteeAuthIds = (calleeRows || [])
      .map((r) => r.auth_id)
      .filter((authId): authId is string => !!authId && authId !== userId);

    if (inviteeAuthIds.length === 0) {
      return errorResponse("validation_error", "No valid participants to call");
    }

    const createRes = await fetch(
      `${supabaseUrl}/functions/v1/video_create_room`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "x-auth-token": req.headers.get("x-auth-token") || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          isPublic: false, // personal calls are never Sneaky Lynk-discoverable
          hasVideo,
          maxParticipants,
          invitedUserIds: inviteeAuthIds,
          appOnly: false,
        }),
      },
    );

    const createPayload = (await createRes.json().catch(() => null)) as
      | ApiResponse<{ room: { internalId: number } }>
      | null;

    if (!createRes.ok || !createPayload?.ok) {
      return jsonResponse(
        createPayload ?? {
          ok: false,
          error: { code: "internal_error", message: "Room creation failed" },
        },
      );
    }

    const internalId = createPayload.data?.room?.internalId;
    if (internalId) {
      const { error: kindErr } = await supabase
        .from("video_rooms")
        .update({ room_kind: "call" })
        .eq("id", internalId);
      if (kindErr) {
        console.error(
          "[call_create] Failed to stamp room_kind=call:",
          kindErr.message,
        );
      }
    }

    return jsonResponse(createPayload);
  } catch (err) {
    console.error("[call_create] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
