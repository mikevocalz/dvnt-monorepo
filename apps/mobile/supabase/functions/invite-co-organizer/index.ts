/**
 * invite-co-organizer Edge Function
 *
 * POST /invite-co-organizer
 * Body shapes:
 *   { action: "invite", event_id, username, role }
 *   { action: "accept",  invite_id }
 *   { action: "decline", invite_id }
 *   { action: "revoke",  invite_id }
 *
 * Permission model:
 *   - 'invite' / 'revoke' require the caller to be the event owner OR
 *     a co-organizer with role='admin'. Only the owner can grant or
 *     revoke 'admin' role.
 *   - 'accept' / 'decline' require the caller to be the invite recipient.
 *
 * Notifications mirror the transfer-ticket pattern: push + in-app feed
 * entry on each action. Best-effort — never blocks the action.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const VALID_ROLES = new Set(["scanner", "editor", "admin"]);

function json(data: unknown, status = 200, req?: Request) {
  const headers = req
    ? { ...corsHeaders(req), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), { status, headers });
}

async function lookupAppUser(
  supabase: any,
  authId: string,
): Promise<{
  id: number;
  username: string | null;
  avatar: string | null;
} | null> {
  const { data } = await supabase
    .from("users")
    .select("id, username, avatar_id(url)")
    .eq("auth_id", authId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    username: data.username ?? null,
    avatar:
      (Array.isArray((data as any).avatar_id)
        ? (data as any).avatar_id[0]?.url
        : (data as any).avatar_id?.url) ?? null,
  };
}

async function notify(
  supabase: any,
  params: {
    recipientIntId: number;
    senderIntId: number;
    senderUsername: string | null;
    senderAvatar: string | null;
    title: string;
    body: string;
    notificationType: string;
    entityId: string;
    eventId: number;
  },
): Promise<void> {
  try {
    await supabase.from("notifications").insert({
      recipient_id: params.recipientIntId,
      actor_id: params.senderIntId,
      type: params.notificationType,
      entity_type: "event",
      entity_id: params.entityId,
    });

    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", params.recipientIntId);

    if (tokens && tokens.length > 0) {
      const messages = tokens.map((t: { token: string }) => ({
        to: t.token,
        title: params.title,
        body: params.body,
        data: {
          type: params.notificationType,
          senderId: String(params.senderIntId),
          senderUsername: params.senderUsername ?? undefined,
          senderAvatar: params.senderAvatar ?? undefined,
          entityType: "event_co_organizer",
          entityId: params.entityId,
          eventId: String(params.eventId),
          url: `https://dvntapp.live/e/${params.eventId}`,
        },
        sound: "default",
        channelId: "default",
      }));
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(messages),
      });
    }
  } catch (err) {
    console.warn("[invite-co-organizer] notify failed (non-fatal):", err);
  }
}

async function getManagerRole(
  supabase: any,
  eventId: number,
  authId: string,
): Promise<"owner" | "admin" | null> {
  const { data: event } = await supabase
    .from("events")
    .select("host_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;
  if (String(event.host_id) === String(authId)) return "owner";
  const { data: coOrg } = await supabase
    .from("event_co_organizers")
    .select("role, accepted")
    .eq("event_id", eventId)
    .eq("user_id", authId)
    .eq("accepted", true)
    .eq("role", "admin")
    .maybeSingle();
  return coOrg ? "admin" : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST")
    return json({ error: "Method not allowed" }, 405, req);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return json({ error: "Unauthorized" }, 401, req);

    const rl = checkRateLimit(authId, "invite-co-organizer", {
      maxRequests: 30,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return json({ error: "Too many requests" }, 429, req);
    }

    let body: {
      action?: string;
      event_id?: number;
      username?: string;
      role?: string;
      invite_id?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, req);
    }

    // ───────────── INVITE ─────────────
    if (body.action === "invite") {
      const eventId = Number(body.event_id);
      const username =
        typeof body.username === "string"
          ? body.username.trim().toLowerCase()
          : "";
      const role = typeof body.role === "string" ? body.role : "";
      if (!Number.isFinite(eventId) || eventId <= 0 || !username || !role) {
        return json(
          { error: "event_id, username, role required" },
          400,
          req,
        );
      }
      if (!VALID_ROLES.has(role)) {
        return json(
          { error: "role must be scanner, editor, or admin" },
          400,
          req,
        );
      }

      const managerRole = await getManagerRole(supabase, eventId, authId);
      if (!managerRole) {
        return json({ error: "Not authorized to manage staff" }, 403, req);
      }
      if (role === "admin" && managerRole !== "owner") {
        return json(
          { error: "Only the event owner can grant admin role" },
          403,
          req,
        );
      }

      const { data: recipient } = await supabase
        .from("user")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      if (!recipient) return json({ error: "User not found" }, 404, req);
      if (recipient.id === authId) {
        return json({ error: "You're already on this event" }, 400, req);
      }

      const { data: ownerCheck } = await supabase
        .from("events")
        .select("host_id, title")
        .eq("id", eventId)
        .maybeSingle();
      if (ownerCheck && String(ownerCheck.host_id) === String(recipient.id)) {
        return json(
          { error: "This user is already the event owner" },
          400,
          req,
        );
      }

      const { data: existing } = await supabase
        .from("event_co_organizers")
        .select("id, accepted")
        .eq("event_id", eventId)
        .eq("user_id", recipient.id)
        .maybeSingle();

      let inviteId: string;
      let reinvited = false;
      if (existing) {
        if (existing.accepted) {
          return json(
            { error: "This user already has a role on this event" },
            409,
            req,
          );
        }
        const { error: updErr } = await supabase
          .from("event_co_organizers")
          .update({ role, invited_by: authId, accepted: false })
          .eq("id", existing.id);
        if (updErr) return json({ error: "Failed to re-invite" }, 500, req);
        inviteId = existing.id;
        reinvited = true;
      } else {
        const { data: created, error: insertErr } = await supabase
          .from("event_co_organizers")
          .insert({
            event_id: eventId,
            user_id: recipient.id,
            role,
            invited_by: authId,
            accepted: false,
          })
          .select("id")
          .single();
        if (insertErr || !created) {
          return json({ error: "Failed to create invite" }, 500, req);
        }
        inviteId = created.id;
      }

      const inviter = await lookupAppUser(supabase, authId);
      const inviteeApp = await lookupAppUser(supabase, recipient.id);
      if (inviter && inviteeApp) {
        const senderHandle = inviter.username
          ? `@${inviter.username}`
          : "An event host";
        await notify(supabase, {
          recipientIntId: inviteeApp.id,
          senderIntId: inviter.id,
          senderUsername: inviter.username,
          senderAvatar: inviter.avatar,
          title: "Event staff invite",
          body: `${senderHandle} invited you to ${ownerCheck?.title || "their event"} as ${role}.`,
          notificationType: "event_co_organizer_invited",
          entityId: inviteId,
          eventId,
        });
      }

      return json({ ok: true, invite_id: inviteId, reinvited }, 200, req);
    }

    // ───────────── ACCEPT / DECLINE ─────────────
    if (body.action === "accept" || body.action === "decline") {
      const inviteId =
        typeof body.invite_id === "string" ? body.invite_id : "";
      if (!inviteId) return json({ error: "invite_id required" }, 400, req);

      const { data: invite } = await supabase
        .from("event_co_organizers")
        .select("id, event_id, user_id, role, invited_by, accepted")
        .eq("id", inviteId)
        .maybeSingle();
      if (!invite) return json({ error: "Invite not found" }, 404, req);
      if (String(invite.user_id) !== String(authId)) {
        return json({ error: "Not your invite" }, 403, req);
      }
      if (invite.accepted && body.action === "accept") {
        return json({ ok: true, alreadyAccepted: true }, 200, req);
      }

      if (body.action === "accept") {
        const { error: updErr } = await supabase
          .from("event_co_organizers")
          .update({ accepted: true })
          .eq("id", inviteId)
          .eq("accepted", false);
        if (updErr) return json({ error: "Failed to accept" }, 500, req);
      } else {
        await supabase
          .from("event_co_organizers")
          .delete()
          .eq("id", inviteId)
          .eq("accepted", false);
      }

      const accepter = await lookupAppUser(supabase, authId);
      const inviterApp = invite.invited_by
        ? await lookupAppUser(supabase, invite.invited_by)
        : null;
      if (accepter && inviterApp) {
        const handle = accepter.username
          ? `@${accepter.username}`
          : "Your invitee";
        await notify(supabase, {
          recipientIntId: inviterApp.id,
          senderIntId: accepter.id,
          senderUsername: accepter.username,
          senderAvatar: accepter.avatar,
          title:
            body.action === "accept"
              ? "Staff invite accepted"
              : "Staff invite declined",
          body:
            body.action === "accept"
              ? `${handle} accepted your ${invite.role} invite.`
              : `${handle} declined your ${invite.role} invite.`,
          notificationType:
            body.action === "accept"
              ? "event_co_organizer_accepted"
              : "event_co_organizer_declined",
          entityId: inviteId,
          eventId: invite.event_id,
        });
      }

      return json({ ok: true }, 200, req);
    }

    // ───────────── REVOKE ─────────────
    if (body.action === "revoke") {
      const inviteId =
        typeof body.invite_id === "string" ? body.invite_id : "";
      if (!inviteId) return json({ error: "invite_id required" }, 400, req);

      const { data: invite } = await supabase
        .from("event_co_organizers")
        .select("id, event_id, user_id, role")
        .eq("id", inviteId)
        .maybeSingle();
      if (!invite) return json({ error: "Invite not found" }, 404, req);

      const managerRole = await getManagerRole(
        supabase,
        invite.event_id,
        authId,
      );
      if (!managerRole) {
        return json({ error: "Not authorized to manage staff" }, 403, req);
      }
      if (invite.role === "admin" && managerRole !== "owner") {
        return json(
          { error: "Only the event owner can revoke admin role" },
          403,
          req,
        );
      }

      const { error: delErr } = await supabase
        .from("event_co_organizers")
        .delete()
        .eq("id", inviteId);
      if (delErr) return json({ error: "Failed to revoke" }, 500, req);

      const revoker = await lookupAppUser(supabase, authId);
      const revokedApp = await lookupAppUser(supabase, invite.user_id);
      if (revoker && revokedApp) {
        const handle = revoker.username
          ? `@${revoker.username}`
          : "An event host";
        await notify(supabase, {
          recipientIntId: revokedApp.id,
          senderIntId: revoker.id,
          senderUsername: revoker.username,
          senderAvatar: revoker.avatar,
          title: "Event staff access removed",
          body: `${handle} removed your ${invite.role} access.`,
          notificationType: "event_co_organizer_revoked",
          entityId: inviteId,
          eventId: invite.event_id,
        });
      }

      return json({ ok: true }, 200, req);
    }

    return json({ error: "Invalid action" }, 400, req);
  } catch (err: any) {
    console.error("[invite-co-organizer] Unexpected:", err);
    return json({ error: err.message || "Internal error" }, 500, req);
  }
});
