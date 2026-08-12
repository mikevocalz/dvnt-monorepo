/**
 * Edge Function: call_join
 * WS-1: personal Calls, split from Sneaky Lynk rooms.
 *
 * Thin wrapper — checks room_kind='call' (structural boundary: a lynk join
 * link can never enter here), then forwards verbatim to video_join_room so
 * the private-room gate, ban check, capacity check, and Fishjam peer minting
 * stay byte-identical between the two stacks.
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

const CallJoinSchema = z.object({
  roomId: z.string().uuid(),
  anonymous: z.boolean().optional(),
  platform: z.string().optional(),
});

type ErrorCode = "unauthorized" | "validation_error" | "not_found" | "internal_error";

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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const parsed = CallJoinSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("validation_error", parsed.error.errors[0].message);
    }

    const { data: room, error: roomErr } = await supabase
      .from("video_rooms")
      .select("room_kind")
      .eq("uuid", parsed.data.roomId)
      .maybeSingle();

    if (roomErr) {
      console.error("[call_join] Room lookup error:", roomErr.message);
      return errorResponse("internal_error", "Failed to look up room");
    }
    if (!room || room.room_kind !== "call") {
      return errorResponse("not_found", "Call not found");
    }

    const joinRes = await fetch(`${supabaseUrl}/functions/v1/video_join_room`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "x-auth-token": req.headers.get("x-auth-token") || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    });

    const joinPayload = await joinRes.json().catch(() => null);
    return new Response(JSON.stringify(joinPayload), {
      status: joinRes.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[call_join] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
