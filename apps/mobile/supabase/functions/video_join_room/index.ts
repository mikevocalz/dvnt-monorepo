/**
 * Edge Function: video_join_room
 * Joins a user to a video room and mints a Fishjam token
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JoinRoomSchema = z.object({
  roomId: z.string().uuid(),
  anonymous: z.boolean().optional().default(false),
});

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "validation_error"
  | "internal_error";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: ErrorCode;
    message: string;
    /**
     * Structured detail payload — populated for error reasons where
     * the client renders a rich surface (e.g. capacity). Never contains
     * secrets; safe to display directly. Consumers should treat
     * unknown keys as forward-compatible additions.
     */
    detail?: Record<string, unknown>;
  };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  code: ErrorCode,
  message: string,
  detail?: Record<string, unknown>,
): Response {
  return jsonResponse(
    { ok: false, error: { code, message, ...(detail ? { detail } : {}) } },
    200,
  );
}

function generateJti(): string {
  return crypto.randomUUID();
}

function shouldRecreateRoomForPeerFailure(status: number): boolean {
  return status === 401 || status === 404 || status >= 500;
}

function normalizeAnonLabel(label?: string | null): string | null {
  if (!label) return null;
  const match = label.match(/anon(?:\s+lynk)?\s+(\d+)/i);
  if (match) return `Anon ${match[1]}`;
  return label;
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
    const fishjamAppId = Deno.env.get("FISHJAM_APP_ID")!;
    const fishjamApiKey = Deno.env.get("FISHJAM_API_KEY")!;
    const fishjamBaseUrl = `https://fishjam.io/api/v1/connect/${fishjamAppId}`;
    console.log(
      `[video_join_room] Fishjam config: appId=${fishjamAppId}, apiKey=${fishjamApiKey?.slice(0, 8)}..., baseUrl=${fishjamBaseUrl}`,
    );

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via direct DB lookup
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

    const userId = session.userId;

    // Parse input
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const parsed = JoinRoomSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("validation_error", parsed.error.errors[0].message);
    }

    const { roomId, anonymous } = parsed.data;

    // Rate limit check
    const { data: canJoin } = await supabase.rpc("check_rate_limit", {
      p_user_id: userId,
      p_action: "join",
      p_room_id: roomId,
      p_max_attempts: 10,
      p_window_seconds: 60,
    });

    if (!canJoin) {
      return errorResponse(
        "rate_limited",
        "Too many join attempts. Try again later.",
      );
    }

    await supabase.rpc("record_rate_limit", {
      p_user_id: userId,
      p_action: "join",
      p_room_id: roomId,
    });

    // Check room exists and is open (lookup by uuid)
    const { data: room, error: roomError } = await supabase
      .from("video_rooms")
      .select("*")
      .eq("uuid", roomId)
      .single();

    if (roomError || !room) {
      return errorResponse("not_found", "Room not found");
    }

    if (room.status !== "open") {
      return errorResponse("conflict", "Room is no longer open");
    }

    const internalRoomId = room.id;

    // Check if user is banned
    const { data: isBanned } = await supabase.rpc("is_user_banned_from_room", {
      p_user_id: userId,
      p_room_id: internalRoomId,
    });

    if (isBanned) {
      return errorResponse("forbidden", "You are banned from this room");
    }

    // Check existing membership before private access and capacity gates.
    // Existing members can rejoin invite-only rooms after disconnects; banned
    // users are still blocked below.
    const { data: existingMember } = await supabase
      .from("video_room_members")
      .select("*")
      .eq("room_id", internalRoomId)
      .eq("user_id", userId)
      .single();

    if (existingMember?.status === "banned") {
      return errorResponse("forbidden", "You are banned from this room");
    }

    if (!room.is_public) {
      const isHostOrCoHost =
        userId === room.created_by ||
        existingMember?.role === "host" ||
        existingMember?.role === "co-host";

      const hasPriorAccess =
        !!existingMember &&
        existingMember.status !== "banned" &&
        existingMember.status !== "kicked";

      let hasInvite = false;
      if (!isHostOrCoHost && !hasPriorAccess) {
        const { data: invite } = await supabase
          .from("video_room_invites")
          .select("id")
          .eq("room_id", internalRoomId)
          .eq("user_id", userId)
          .maybeSingle();
        hasInvite = !!invite;
      }

      if (!isHostOrCoHost && !hasPriorAccess && !hasInvite) {
        return errorResponse("forbidden", "This private Lynk is invite-only", {
          reason: "invite_only",
        });
      }
    }

    // Check participant count
    const { data: participantCount } = await supabase.rpc(
      "count_active_participants",
      {
        p_room_id: internalRoomId,
      },
    );

    if (participantCount >= room.max_participants) {
      // Include structured capacity data so the client can render a
      // rich "room is full" surface with the real counts + host context
      // rather than a bare message. Client treats this as the source
      // of truth for the capacity flow.
      return errorResponse("conflict", "Room is full", {
        reason: "room_full",
        current: participantCount,
        max: room.max_participants,
        // Was the user requesting this join the host? Lets the client
        // show an upgrade CTA for hosts vs a wait-notify UX for viewers.
        isHost: session.userId === room.host_id,
      });
    }

    let memberRole = "participant";

    // Compute anon label if joining anonymously
    let anonLabel: string | null = null;
    if (anonymous) {
      const { count } = await supabase
        .from("video_room_members")
        .select("id", { count: "exact", head: true })
        .eq("room_id", internalRoomId)
        .eq("is_anonymous", true);
      anonLabel = `Anon ${(count ?? 0) + 1}`;
      anonLabel = normalizeAnonLabel(existingMember?.anon_label) || anonLabel;
    }

    if (existingMember) {
      if (existingMember.status === "active") {
        // Already in room, just refresh token
        memberRole = existingMember.role;
        anonLabel = normalizeAnonLabel(existingMember.anon_label) || anonLabel;
      } else if (existingMember.status === "banned") {
        return errorResponse("forbidden", "You are banned from this room");
      } else {
        // Rejoin (was kicked or left)
        const { error: updateError } = await supabase
          .from("video_room_members")
          .update({
            status: "active",
            joined_at: new Date().toISOString(),
            left_at: null,
            hand_raised: false,
            is_anonymous: anonymous,
            anon_label: anonLabel,
          })
          .eq("room_id", internalRoomId)
          .eq("user_id", userId);

        if (updateError) {
          console.error("[video_join_room] Rejoin error:", updateError.message);
          return errorResponse("internal_error", "Failed to rejoin room");
        }
        memberRole = existingMember.role;
      }
    } else {
      // New member
      const { error: insertError } = await supabase
        .from("video_room_members")
        .insert({
          room_id: internalRoomId,
          user_id: userId,
          role: "participant",
          status: "active",
          hand_raised: false,
          is_anonymous: anonymous,
          anon_label: anonLabel,
        });

      if (insertError) {
        console.error("[video_join_room] Insert error:", insertError.message);
        return errorResponse("internal_error", "Failed to join room");
      }
    }

    // Update participant count
    await supabase
      .rpc("count_active_participants", { p_room_id: internalRoomId })
      .then(async ({ data: count }) => {
        if (count !== null) {
          await supabase
            .from("video_rooms")
            .update({ participant_count: count })
            .eq("id", internalRoomId);
        }
      });

    // Reuse existing Fishjam room if one exists; only create a new one if needed.
    // CRITICAL: Creating a new room on every join puts each participant in a
    // separate Fishjam room, breaking all calls with peer_join_failed.
    let fishjamRoomId: string | null = room.fishjam_room_id || null;

    async function createFishjamRoom(): Promise<string> {
      const fishjamRoomUrl = `${fishjamBaseUrl}/room`;
      console.log(
        "[video_join_room] Creating Fishjam room at:",
        fishjamRoomUrl,
      );
      const createRoomRes = await fetch(fishjamRoomUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fishjamApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maxPeers: room.max_participants,
          videoCodec: "h264",
        }),
      });

      if (!createRoomRes.ok) {
        const errText = await createRoomRes.text();
        console.error(
          "[video_join_room] Fishjam room creation failed:",
          createRoomRes.status,
          errText,
        );
        throw new Error(
          `Fishjam room creation failed (${createRoomRes.status}): ${errText.slice(0, 200)}`,
        );
      }

      const fishjamRoom = await createRoomRes.json();
      const newRoomId = fishjamRoom.data.room.id;
      console.log("[video_join_room] Fishjam room created:", newRoomId);

      // Persist Fishjam room ID so subsequent joiners reuse it
      await supabase
        .from("video_rooms")
        .update({ fishjam_room_id: newRoomId })
        .eq("id", internalRoomId);

      return newRoomId;
    }

    // Create Fishjam room only if one doesn't exist yet
    if (!fishjamRoomId) {
      try {
        fishjamRoomId = await createFishjamRoom();
      } catch (e: any) {
        return errorResponse("internal_error", e.message);
      }
    } else {
      console.log(
        "[video_join_room] Reusing existing Fishjam room:",
        fishjamRoomId,
      );
    }

    // Create peer in Fishjam and get token
    const jti = generateJti();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Fetch the joiner's profile BEFORE peer creation so we can pass
    // metadata (username, displayName, avatar, role, userId) to Fishjam.
    // Without this metadata, other peers see empty strings for this
    // joiner's name and fall back to "Guest" — which is what users
    // reported for hosts in particular. Fetched once here, reused at
    // the bottom of the function for the userPayload response.
    let joinerProfile: {
      username?: string | null;
      displayName?: string | null;
      avatar?: string | null;
    } = {};
    if (!(anonymous && anonLabel)) {
      const { data: profile } = await supabase
        .from("users")
        .select("username, avatar:avatar_id(url)")
        .eq("auth_id", userId)
        .single();
      joinerProfile = {
        username: profile?.username ?? null,
        displayName: profile?.username ?? null,
        avatar: profile?.avatar?.url ?? null,
      };
    }

    const peerMetadata =
      anonymous && anonLabel
        ? {
            userId,
            username: anonLabel,
            displayName: anonLabel,
            avatar: null,
            role: memberRole,
            isAnonymous: true,
            anonLabel,
          }
        : {
            userId,
            username: joinerProfile.username,
            displayName: joinerProfile.displayName,
            avatar: joinerProfile.avatar,
            role: memberRole,
            isAnonymous: false,
            anonLabel: null,
          };

    const createFishjamPeer = (targetRoomId: string) =>
      fetch(`${fishjamBaseUrl}/room/${targetRoomId}/peer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fishjamApiKey}`,
          "Content-Type": "application/json",
        },
        // Passing `metadata` here makes the peer's username + role
        // visible to every other peer in the room via peer.metadata.
        body: JSON.stringify({ type: "webrtc", metadata: peerMetadata }),
      });

    let addPeerRes = await createFishjamPeer(fishjamRoomId);

    // 401/404 means the persisted Fishjam room is stale. 5xx is treated the
    // same way because we've seen peer creation fail against a corrupt room
    // while room creation still succeeds; recreating the room lets new joins recover.
    if (shouldRecreateRoomForPeerFailure(addPeerRes.status)) {
      console.warn(
        `[video_join_room] Fishjam peer returned ${addPeerRes.status} — recreating room and retrying`,
      );
      if (fishjamRoomId) {
        try {
          await fetch(`${fishjamBaseUrl}/room/${fishjamRoomId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${fishjamApiKey}` },
          });
        } catch (deleteErr) {
          console.warn(
            "[video_join_room] Failed to delete stale Fishjam room before recreate:",
            deleteErr,
          );
        }
      }
      try {
        fishjamRoomId = await createFishjamRoom();
      } catch (e: any) {
        return errorResponse("internal_error", e.message);
      }

      addPeerRes = await createFishjamPeer(fishjamRoomId);
    }

    if (!addPeerRes.ok) {
      const errText = await addPeerRes.text();
      console.error(
        "[video_join_room] Fishjam peer creation failed:",
        addPeerRes.status,
        errText,
      );
      return errorResponse(
        "internal_error",
        `Fishjam peer failed (${addPeerRes.status}): ${errText.slice(0, 200)}`,
      );
    }

    const peerData = await addPeerRes.json();
    const { peer, token: fishjamToken } = peerData.data;

    // Store token for revocation tracking
    const { error: tokenError } = await supabase
      .from("video_room_tokens")
      .insert({
        room_id: internalRoomId,
        user_id: userId,
        token_jti: jti,
        expires_at: expiresAt.toISOString(),
      });

    if (tokenError) {
      console.error(
        "[video_join_room] Token storage error:",
        tokenError.message,
      );
    }

    // Log event
    await supabase.from("video_room_events").insert({
      room_id: internalRoomId,
      type: "member_joined",
      actor_id: userId,
      payload: { role: memberRole, peerId: peer.id },
    });

    // Build user payload for the response. For the anon case we use the
    // anon label; otherwise reuse the profile we already fetched before
    // peer creation (we pass it as Fishjam metadata so remote peers
    // resolve a real username instead of falling back to "Guest").
    let userPayload: Record<string, any>;
    if (anonymous && anonLabel) {
      userPayload = {
        id: userId,
        username: anonLabel,
        displayName: anonLabel,
        avatar: null,
        isAnonymous: true,
        anonLabel,
      };
    } else {
      userPayload = {
        id: userId,
        username: joinerProfile.username,
        displayName: joinerProfile.displayName,
        avatar: joinerProfile.avatar,
        isAnonymous: false,
        anonLabel: null,
      };
    }

    console.log(
      `[video_join_room] User ${userId} joined room ${roomId} (anon=${anonymous})`,
    );

    return jsonResponse({
      ok: true,
      data: {
        room: {
          id: room.uuid || room.id,
          internalId: room.id,
          title: room.title,
          sweetSpicyMode: room.sweet_spicy_mode || "sweet",
          fishjamRoomId,
        },
        token: fishjamToken,
        peer: {
          id: peer.id,
          role: memberRole,
        },
        user: userPayload,
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[video_join_room] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
