/**
 * Edge Function: video_list_rooms
 * Lists public Sneaky Lynks plus invite-only rooms available to the caller.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode = "unauthorized" | "validation_error" | "internal_error";
// Fallback window for clients that don't send presence heartbeats yet (no
// last_seen_at): assume a member could still be live for a long session.
const OPEN_MEMBER_FRESHNESS_MS = 12 * 60 * 60 * 1000;
// Tight window for clients that DO heartbeat (last_seen_at present): if they
// stop pinging (~30s cadence) the room reads dead within ~90s.
const HEARTBEAT_FRESHNESS_MS = 90 * 1000;

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

function resolveRoomAudience(
  room: {
    id: number;
    status: "open" | "ended";
    participant_count?: number | null;
    created_at?: string | null;
  },
  stats:
    | { activeCount: number; activeHostCount: number; historicalCount: number }
    | undefined,
  nowMs: number,
): { isLive: boolean; listeners: number } {
  if (room.status === "open") {
    return {
      isLive: (stats?.activeHostCount ?? 0) > 0,
      listeners: Math.max(
        Number(room.participant_count ?? 0),
        stats?.activeCount ?? 0,
      ),
    };
  }

  const endedRecently =
    room.created_at != null &&
    nowMs - new Date(room.created_at).getTime() < 24 * 60 * 60 * 1000;

  return {
    isLive: false,
    listeners: Math.max(
      Number(room.participant_count ?? 0),
      stats?.historicalCount ?? 0,
      endedRecently ? (stats?.activeCount ?? 0) : 0,
    ),
  };
}

function buildRoomParticipantStats(
  members: Array<{
    room_id: number;
    user_id?: string | null;
    role?: string | null;
    status?: string | null;
    joined_at?: string | null;
    last_seen_at?: string | null;
    left_at?: string | null;
  }>,
  nowMs: number,
): Record<
  number,
  { activeCount: number; activeHostCount: number; historicalCount: number }
> {
  const stats: Record<
    number,
    { activeCount: number; activeHostCount: number; historicalCount: number }
  > = {};

  for (const member of members) {
    if (!stats[member.room_id]) {
      stats[member.room_id] = {
        activeCount: 0,
        activeHostCount: 0,
        historicalCount: 0,
      };
    }

    stats[member.room_id].historicalCount += 1;

    // Heartbeating clients carry last_seen_at → tight window. Others fall back
    // to joined_at on the lenient window (no regression for not-yet-updated apps).
    const lastSeenMs = member.last_seen_at ? Date.parse(member.last_seen_at) : NaN;
    const joinedAtMs = member.joined_at ? Date.parse(member.joined_at) : NaN;
    const hasHeartbeat = Number.isFinite(lastSeenMs);
    const freshMs = hasHeartbeat ? lastSeenMs : joinedAtMs;
    const freshWindow = hasHeartbeat
      ? HEARTBEAT_FRESHNESS_MS
      : OPEN_MEMBER_FRESHNESS_MS;
    const isActive =
      member.status === "active" &&
      Number.isFinite(freshMs) &&
      nowMs - freshMs <= freshWindow;

    if (isActive) {
      stats[member.room_id].activeCount += 1;
      if (member.role === "host" || member.role === "co-host") {
        stats[member.room_id].activeHostCount += 1;
      }
    }
  }

  return stats;
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

    const jwt = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    const { data: session, error: sessionError } = await supabase
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", jwt)
      .single();

    if (sessionError || !session) {
      return errorResponse("unauthorized", "Invalid or expired session");
    }

    if (new Date(session.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }

    const userId = String(session.userId);
    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const nowMs = Date.now();

    const roomStatusFilter = `status.eq.open,and(status.eq.ended,ended_at.gte.${twentyFourHoursAgo})`;
    const { data: publicRooms, error: publicError } = await supabase
      .from("video_rooms")
      .select("*")
      .eq("is_public", true)
      .or(roomStatusFilter)
      .order("status", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (publicError) {
      console.error("[video_list_rooms] Public rooms error:", publicError);
      return errorResponse("internal_error", "Could not load rooms");
    }

    const { data: invites, error: invitesError } = await supabase
      .from("video_room_invites")
      .select("room_id")
      .eq("user_id", userId);

    if (invitesError) {
      console.error("[video_list_rooms] Invites error:", invitesError);
      return errorResponse("internal_error", "Could not load room invites");
    }

    const invitedRoomIds = [
      ...new Set((invites || []).map((invite: any) => invite.room_id)),
    ].filter(Boolean);

    let privateRooms: any[] = [];
    if (invitedRoomIds.length > 0) {
      const { data, error } = await supabase
        .from("video_rooms")
        .select("*")
        .in("id", invitedRoomIds)
        .or(roomStatusFilter)
        .order("status", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("[video_list_rooms] Invited rooms error:", error);
        return errorResponse("internal_error", "Could not load invited rooms");
      }

      privateRooms = data || [];
    }

    const { data: ownedRooms, error: ownedError } = await supabase
      .from("video_rooms")
      .select("*")
      .eq("created_by", userId)
      .eq("is_public", false)
      .or(roomStatusFilter)
      .order("status", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (ownedError) {
      console.error("[video_list_rooms] Owned rooms error:", ownedError);
      return errorResponse("internal_error", "Could not load owned rooms");
    }

    const roomsById = new Map<number, any>();
    for (const room of [
      ...(publicRooms || []),
      ...privateRooms,
      ...(ownedRooms || []),
    ]) {
      roomsById.set(room.id, room);
    }

    const rooms = [...roomsById.values()].sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return (
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
      );
    });

    const creatorIds = [
      ...new Set(rooms.map((room: any) => room.created_by).filter(Boolean)),
    ];
    const creatorsMap: Record<string, any> = {};
    if (creatorIds.length > 0) {
      const { data: creators } = await supabase
        .from("users")
        .select(
          "id, auth_id, username, first_name, avatar:avatar_id(url), verified",
        )
        .in("auth_id", creatorIds);

      for (const creator of creators || []) {
        creatorsMap[creator.auth_id] = creator;
      }
    }

    const roomIds = rooms.map((room: any) => room.id).filter(Boolean);
    let roomStats: Record<
      number,
      { activeCount: number; activeHostCount: number; historicalCount: number }
    > = {};
    if (roomIds.length > 0) {
      const { data: members } = await supabase
        .from("video_room_members")
        .select("room_id, user_id, role, status, joined_at, last_seen_at, left_at")
        .in("room_id", roomIds);

      roomStats = buildRoomParticipantStats(members || [], nowMs);
    }

    return jsonResponse({
      ok: true,
      data: {
        rooms: rooms.map((room: any) => {
          const creator = creatorsMap[room.created_by] || null;
          const audience = resolveRoomAudience(
            {
              id: room.id,
              status: room.status as "open" | "ended",
              participant_count: room.participant_count,
              created_at: room.created_at,
            },
            roomStats[room.id],
            nowMs,
          );

          return {
            id: room.uuid || String(room.id),
            createdBy: room.created_by || "",
            title: room.title || "Untitled Lynk",
            topic: room.topic || "",
            description: room.description || "",
            sweetSpicyMode: room.sweet_spicy_mode || "sweet",
            isLive: audience.isLive,
            hasVideo: room.has_video ?? false,
            isPublic: room.is_public ?? true,
            status: room.status,
            createdAt: room.created_at,
            endedAt: room.ended_at || undefined,
            host: {
              id: String(creator?.id || ""),
              username: creator?.username || "unknown",
              displayName:
                creator?.first_name || creator?.username || "unknown",
              avatar: creator?.avatar?.url || "",
              isVerified: creator?.verified || false,
            },
            speakers: [],
            listeners: audience.listeners,
            maxParticipants: room.max_participants || 50,
            fishjamRoomId: room.fishjam_room_id || undefined,
          };
        }),
      },
    });
  } catch (error) {
    console.error("[video_list_rooms] Unexpected error:", error);
    return errorResponse("internal_error", "Internal server error");
  }
});
