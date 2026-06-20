/**
 * Edge Function: video_heartbeat
 * Refreshes the caller's membership freshness in a video room. video_list_rooms
 * treats a member as "active" only if their joined_at is within a short window,
 * so the live client pings this every ~30s while connected. When pings stop
 * (host closed the tab/app without a clean leave), the room goes dark within the
 * window instead of showing LIVE for hours.
 *
 * Deploy: supabase functions deploy video_heartbeat --project-ref npfjanxturvmjyevoyfo
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HeartbeatSchema = z.object({ roomId: z.string().uuid() });

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const err = (code: string, message: string) =>
  json({ ok: false, error: { code, message } }, 200);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return err("validation_error", "Method not allowed");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return err("unauthorized", "Missing or invalid Authorization header");
    }
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
          },
        },
      },
    );

    const { data: session } = await supabase
      .from("session")
      .select("userId, expiresAt")
      .eq("token", jwt)
      .single();
    if (!session || new Date(session.expiresAt) < new Date()) {
      return err("unauthorized", "Invalid or expired session");
    }
    const userId = session.userId;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("validation_error", "Invalid JSON body");
    }
    const parsed = HeartbeatSchema.safeParse(body);
    if (!parsed.success) {
      return err("validation_error", parsed.error.errors[0].message);
    }
    const { roomId } = parsed.data;

    const { data: room } = await supabase
      .from("video_rooms")
      .select("id, status")
      .eq("uuid", roomId)
      .single();
    if (!room) return err("not_found", "Room not found");
    if (room.status === "ended") return json({ ok: true, data: { ok: true } });

    // Refresh freshness for this member's active membership. Uses last_seen_at
    // (not joined_at) so video_list_rooms can apply a tight window to clients
    // that heartbeat while leaving non-heartbeating (older) clients on the
    // lenient joined_at fallback — no regression for not-yet-updated apps.
    await supabase
      .from("video_room_members")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .eq("status", "active");

    return json({ ok: true, data: { ok: true } });
  } catch (e) {
    return err("internal_error", e instanceof Error ? e.message : "heartbeat failed");
  }
});
