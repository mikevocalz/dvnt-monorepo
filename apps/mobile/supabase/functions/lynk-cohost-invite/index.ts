/**
 * Edge Function: lynk-cohost-invite
 *
 *   { action: "invite",  roomId, targetUserId }
 *   { action: "accept",  inviteId }
 *   { action: "decline", inviteId }
 *
 * Why this exists: `video_change_role` flips someone's role underneath them.
 * That is right for a moderator demoting a speaker, and wrong for asking someone
 * to co-host — being handed responsibility is a thing you agree to. It also only
 * reaches someone already in the room and looking at it; there was nothing to
 * accept later and nothing that survived closing the app.
 *
 * Modelled on `invite-co-organizer`, which does the same for events and already
 * proved the shape: a pending row + a notification + a push, then an accept that
 * performs the privileged write.
 *
 * Authorization lives here, with the service role, because this app uses
 * Better-Auth: `auth.uid()` is null inside Postgres, so RLS cannot express
 * "the host of this room" or "the person invited". The table grants the client
 * SELECT only.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "internal_error";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function errorResponse(code: ErrorCode, message: string): Response {
  console.error(`[Edge:lynk-cohost-invite] ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } });
}

/** Roles allowed to hand out a co-host seat. Mirrors the room's own model. */
const CAN_INVITE = new Set(["host", "co-host"]);

/** Best-effort notification + push. Never fails the mutation it follows: the
 *  role change is the truth, the notification is how someone hears about it. */
async function notify(
  supabase: any,
  opts: {
    recipientAuthId: string;
    actorAuthId: string;
    type: string;
    roomId: number;
    title: string;
    body: string;
    inviteId?: number;
  },
) {
  try {
    // `notifications` is keyed by the users table's INTEGER id, while room
    // membership is keyed by the Better-Auth id. Resolve across.
    const { data: people } = await supabase
      .from("users")
      .select("id, auth_id, username")
      .in("auth_id", [opts.recipientAuthId, opts.actorAuthId]);
    const recipient = people?.find(
      (u: any) => u.auth_id === opts.recipientAuthId,
    );
    const actor = people?.find((u: any) => u.auth_id === opts.actorAuthId);
    if (!recipient) return;

    await supabase.from("notifications").insert({
      recipient_id: recipient.id,
      actor_id: actor?.id ?? null,
      type: opts.type,
      entity_type: "lynk_room",
      entity_id: String(opts.roomId),
      entity_payload: {
        roomId: opts.roomId,
        inviteId: opts.inviteId ?? null,
        actorUsername: actor?.username ?? null,
      },
    });

    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", recipient.id);
    if (!tokens?.length) return;

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        tokens.map((t: { token: string }) => ({
          to: t.token,
          title: opts.title,
          body: opts.body,
          sound: "default",
          channelId: "default",
          data: {
            type: opts.type,
            entityType: "lynk_room",
            roomId: String(opts.roomId),
            inviteId: opts.inviteId ? String(opts.inviteId) : undefined,
          },
        })),
      ),
    });
  } catch (err) {
    console.error("[Edge:lynk-cohost-invite] notify failed (non-fatal):", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
          },
        },
      },
    );

    const session = await verifySessionDetailed(supabase, req);
    if (!session.ok) {
      return errorResponse(
        "unauthorized",
        session.reason === "expired"
          ? "Session expired"
          : "Invalid or expired session",
      );
    }
    const callerId = session.userId;

    let body: {
      action?: string;
      roomId?: string | number;
      targetUserId?: string;
      inviteId?: number;
    };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    // ── invite ──────────────────────────────────────────────────────────────
    if (body.action === "invite") {
      const { roomId, targetUserId } = body;
      if (!roomId || !targetUserId) {
        return errorResponse(
          "validation_error",
          "roomId and targetUserId are required",
        );
      }
      if (targetUserId === callerId) {
        return errorResponse("validation_error", "You are already the host");
      }

      // Rooms are addressed by uuid on the client and by integer id in the DB.
      const { data: room } = await supabase
        .from("video_rooms")
        .select("id, status")
        .eq(
          typeof roomId === "number" || /^\d+$/.test(String(roomId))
            ? "id"
            : "uuid",
          roomId,
        )
        .maybeSingle();
      if (!room) return errorResponse("not_found", "Room not found");
      if (room.status !== "open") {
        return errorResponse("conflict", "That Lynk is no longer open");
      }

      const { data: caller } = await supabase
        .from("video_room_members")
        .select("role, status")
        .eq("room_id", room.id)
        .eq("user_id", callerId)
        .maybeSingle();
      if (!caller || caller.status !== "active" || !CAN_INVITE.has(caller.role)) {
        return errorResponse(
          "forbidden",
          "Only the host can invite a co-host",
        );
      }

      const { data: invite, error } = await supabase
        .from("lynk_cohost_invites")
        .insert({
          room_id: room.id,
          inviter_id: callerId,
          invitee_id: targetUserId,
        })
        .select("id")
        .single();

      if (error) {
        // The partial unique index — an invite is already open for them.
        if (String(error.code) === "23505") {
          return errorResponse(
            "conflict",
            "They already have a pending invite to this Lynk",
          );
        }
        console.error("[Edge:lynk-cohost-invite] insert:", error.message);
        return errorResponse("internal_error", "Couldn't send that invite");
      }

      await notify(supabase, {
        recipientAuthId: targetUserId,
        actorAuthId: callerId,
        type: "lynk_cohost_invited",
        roomId: room.id,
        inviteId: invite.id,
        title: "Invitation to co-host",
        body: "You've been asked to co-host a Lynk. Tap to join.",
      });

      return jsonResponse({ ok: true, data: { inviteId: invite.id } });
    }

    // ── accept / decline ────────────────────────────────────────────────────
    if (body.action === "accept" || body.action === "decline") {
      const inviteId = Number(body.inviteId);
      if (!Number.isInteger(inviteId)) {
        return errorResponse("validation_error", "inviteId is required");
      }

      const { data: invite } = await supabase
        .from("lynk_cohost_invites")
        .select("id, room_id, inviter_id, invitee_id, status")
        .eq("id", inviteId)
        .maybeSingle();
      if (!invite) return errorResponse("not_found", "Invite not found");

      // Only the person invited may answer. A foreign id is a not-found, never
      // a 403 that confirms the invite exists.
      if (invite.invitee_id !== callerId) {
        return errorResponse("not_found", "Invite not found");
      }
      if (invite.status !== "pending") {
        return errorResponse("conflict", `Invite already ${invite.status}`);
      }

      const { data: room } = await supabase
        .from("video_rooms")
        .select("id, uuid, status")
        .eq("id", invite.room_id)
        .maybeSingle();
      if (!room || room.status !== "open") {
        // Mark it resolved so a dead invite stops sitting in the list.
        await supabase
          .from("lynk_cohost_invites")
          .update({ status: "declined", responded_at: new Date().toISOString() })
          .eq("id", inviteId);
        return errorResponse("conflict", "That Lynk has ended");
      }

      if (body.action === "decline") {
        await supabase
          .from("lynk_cohost_invites")
          .update({ status: "declined", responded_at: new Date().toISOString() })
          .eq("id", inviteId);
        await notify(supabase, {
          recipientAuthId: invite.inviter_id,
          actorAuthId: callerId,
          type: "lynk_cohost_declined",
          roomId: room.id,
          title: "Co-host invite declined",
          body: "They can't co-host right now.",
        });
        return jsonResponse({ ok: true, data: { status: "declined" } });
      }

      // ACCEPT is the privileged write: it is what actually grants the seat.
      // Upsert, because the invitee may never have been in the room — accepting
      // from a notification is a join AND a promotion in one step.
      const { data: existing } = await supabase
        .from("video_room_members")
        .select("id")
        .eq("room_id", room.id)
        .eq("user_id", callerId)
        .maybeSingle();

      const memberWrite = existing
        ? supabase
            .from("video_room_members")
            .update({ role: "co-host", status: "active", left_at: null })
            .eq("id", existing.id)
        : supabase.from("video_room_members").insert({
            room_id: room.id,
            user_id: callerId,
            role: "co-host",
            status: "active",
          });

      const { error: memberError } = await memberWrite;
      if (memberError) {
        console.error("[Edge:lynk-cohost-invite] member:", memberError.message);
        return errorResponse("internal_error", "Couldn't add you as co-host");
      }

      await supabase
        .from("lynk_cohost_invites")
        .update({ status: "accepted", responded_at: new Date().toISOString() })
        .eq("id", inviteId);

      // The room listens on this channel; an accepted invite has to look like
      // any other role change to clients already in the room.
      await supabase.from("video_room_events").insert({
        room_id: room.id,
        type: "role_changed",
        target_id: callerId,
        payload: { newRole: "co-host", via: "invite" },
      });

      await notify(supabase, {
        recipientAuthId: invite.inviter_id,
        actorAuthId: callerId,
        type: "lynk_cohost_accepted",
        roomId: room.id,
        title: "Co-host accepted",
        body: "They're joining as a co-host.",
      });

      return jsonResponse({
        ok: true,
        data: { status: "accepted", roomId: room.uuid, role: "co-host" },
      });
    }

    return errorResponse(
      "validation_error",
      "action must be invite, accept or decline",
    );
  } catch (err) {
    console.error("[Edge:lynk-cohost-invite] unexpected:", err);
    return errorResponse("internal_error", "Something went wrong");
  }
});
