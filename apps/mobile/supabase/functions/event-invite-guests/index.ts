/**
 * event-invite-guests Edge Function — the guest list for a private event.
 *
 * POST /event-invite-guests
 *   { action: "list",   event_id }
 *   { action: "invite", event_id, recipients: string[], note? }
 *   { action: "revoke", event_id, invited_user_id? , invited_email? }
 *
 * A guest is not a co-organizer. A co-organizer manages the event; a guest can
 * open it and attend it. Staff live in `event_co_organizers`, guests here in
 * `event_invites` — the table that has existed since the ticketing-v2 migration
 * and, until this function, had no writer at all.
 *
 * Authorization is the same rule bulk-comp-tickets enforces, not a looser one:
 * the event owner, or a co-organizer row with `accepted = true` AND
 * `role = 'admin'`. Nobody can self-invite — the write happens on the service
 * role only after that check, and `event_invites_insert` RLS still requires the
 * caller be `events.host_id` for anything going through PostgREST.
 *
 * Idempotent per (event_id, invited_user_id) and per (event_id,
 * lower(invited_email)), enforced by unique indexes in
 * 20260916193000_event_guest_invites.sql as well as by the plan step here.
 *
 * Email invites write `invited_email` and send the invite. That row grants
 * nothing on its own: `can_view_event` only honours it once an account whose
 * address Supabase Auth has confirmed matches it.
 *
 * Rate-limited 5 mutations per 5 minutes per (caller, event), like its siblings.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import {
  canInviteGuests,
  parseGuestRecipients,
  planGuestInviteRows,
  type ResolvedGuest,
} from "../_shared/guest-invites.ts";
import { sendResendEmail, broadcast } from "../_shared/send-resend-email.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = (
  Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live"
).replace(/\/$/, "");

const MAX_BATCH = 100;

function json(data: unknown, status = 200, req?: Request) {
  const headers = req
    ? { ...corsHeaders(req), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), { status, headers });
}

function err(message: string, status: number, req: Request) {
  return json({ ok: false, error: { message } }, status, req);
}

/** Owner, or an accepted admin co-organizer. Anything else is not staff here. */
async function callerRole(
  supabase: any,
  eventId: number,
  authId: string,
  hostId: string,
): Promise<"owner" | "admin" | "editor" | "scanner" | null> {
  if (String(hostId) === String(authId)) return "owner";
  const { data } = await supabase
    .from("event_co_organizers")
    .select("role, accepted")
    .eq("event_id", eventId)
    .eq("user_id", authId)
    .eq("accepted", true)
    .maybeSingle();
  const role = data?.role;
  return role === "admin" || role === "editor" || role === "scanner"
    ? role
    : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return err("Method not allowed", 405, req);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return err("Unauthorized", 401, req);

    let body: {
      action?: string;
      event_id?: number | string;
      recipients?: string[];
      note?: string;
      invited_user_id?: string;
      invited_email?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return err("Invalid JSON body", 400, req);
    }

    const action = String(body.action || "");
    if (!["list", "invite", "revoke"].includes(action)) {
      return err("action must be list, invite or revoke", 400, req);
    }
    const eventId = Number(body.event_id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return err("event_id required", 400, req);
    }

    const { data: event } = await supabase
      .from("events")
      .select("id, host_id, title, status, visibility, flyer_image_url, dominant_color")
      .eq("id", eventId)
      .maybeSingle();
    if (!event) return err("Event not found", 404, req);

    const role = await callerRole(supabase, eventId, authId, event.host_id);
    if (!canInviteGuests(role)) {
      return err(
        "Only the event owner or an admin co-organizer can manage the guest list",
        403,
        req,
      );
    }

    // ── list ───────────────────────────────────────────────────────────────
    // The host's own roster. Usernames and avatars are resolved here rather
    // than by the client so a guest list is never a public projection.
    if (action === "list") {
      const { data: rows } = await supabase
        .from("event_invites")
        .select("id, invited_user_id, invited_email, status, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });
      const authIds = (rows || [])
        .map((r: any) => r.invited_user_id)
        .filter((v: unknown): v is string => typeof v === "string");
      const profiles = new Map<string, { username: string; avatar: string }>();
      if (authIds.length > 0) {
        const { data: users } = await supabase
          .from("users")
          .select("auth_id, username, avatar_id(url)")
          .in("auth_id", authIds);
        for (const u of users || []) {
          const media = (u as any).avatar_id;
          profiles.set(String((u as any).auth_id), {
            username: (u as any).username ?? "",
            avatar: (Array.isArray(media) ? media[0]?.url : media?.url) ?? "",
          });
        }
      }
      return json(
        {
          ok: true,
          data: {
            guests: (rows || []).map((r: any) => ({
              id: r.id,
              authId: r.invited_user_id ?? null,
              email: r.invited_email ?? null,
              status: r.status ?? "pending",
              username: profiles.get(String(r.invited_user_id))?.username ?? null,
              avatar: profiles.get(String(r.invited_user_id))?.avatar ?? "",
            })),
          },
        },
        200,
        req,
      );
    }

    const rl = checkRateLimit(authId, `guest-invites:${eventId}`, {
      maxRequests: 5,
      windowMs: 5 * 60_000,
    });
    if (!rl.allowed) {
      return err(
        "Too many guest-list changes. Wait a few minutes and try again.",
        429,
        req,
      );
    }

    // ── revoke ─────────────────────────────────────────────────────────────
    // Deleting the row is what removes access: can_view_event has no other
    // source for this guest, so the next request they make is refused.
    if (action === "revoke") {
      const targetUser =
        typeof body.invited_user_id === "string" ? body.invited_user_id : "";
      const targetEmail =
        typeof body.invited_email === "string"
          ? body.invited_email.trim().toLowerCase()
          : "";
      if (!targetUser && !targetEmail) {
        return err("invited_user_id or invited_email required", 400, req);
      }
      const query = supabase.from("event_invites").delete().eq("event_id", eventId);
      const { data: removed, error: delError } = await (targetUser
        ? query.eq("invited_user_id", targetUser)
        : query.ilike("invited_email", targetEmail)
      ).select("id");
      if (delError) {
        console.error("[event-invite-guests] revoke failed:", delError);
        return err("Could not remove that guest. Try again.", 500, req);
      }
      return json(
        { ok: true, data: { revoked: removed?.length ?? 0 } },
        200,
        req,
      );
    }

    // ── invite ─────────────────────────────────────────────────────────────
    if (event.status === "cancelled") {
      return err("Event is cancelled", 409, req);
    }
    const raws = Array.isArray(body.recipients) ? body.recipients : [];
    if (raws.length === 0) return err("At least one guest required", 400, req);
    if (raws.length > MAX_BATCH) {
      return err(`Batch too large; max ${MAX_BATCH} guests per call`, 400, req);
    }

    const { routes, skipped } = parseGuestRecipients(raws);

    // Usernames → auth_id. A handle with no account is a dead end: there is
    // nothing to notify and nothing to key the row on.
    const usernames = routes
      .filter((r) => r.route === "member")
      .map((r) => (r as { username: string }).username);
    const byUsername = new Map<string, { authId: string; intId: number }>();
    if (usernames.length > 0) {
      const { data: users, error: lookupError } = await supabase
        .from("users")
        .select("id, username, auth_id")
        .in("username", usernames);
      if (lookupError) {
        console.error("[event-invite-guests] username lookup:", lookupError);
        return err("Could not resolve those usernames. Try again.", 500, req);
      }
      for (const u of users || []) {
        byUsername.set(String((u as any).username).toLowerCase(), {
          authId: (u as any).auth_id,
          intId: (u as any).id,
        });
      }
    }

    const resolved: ResolvedGuest[] = [];
    const intIdByAuthId = new Map<string, number>();
    for (const route of routes) {
      if (route.route === "email") {
        resolved.push({ raw: route.raw, email: route.email });
        continue;
      }
      const account = byUsername.get(route.username);
      if (!account?.authId) {
        skipped.push({
          recipient: route.raw,
          reason: "No DVNT account with that username; invite them by email",
        });
        continue;
      }
      if (String(account.authId) === String(event.host_id)) {
        skipped.push({ recipient: route.raw, reason: "That's the host" });
        continue;
      }
      intIdByAuthId.set(String(account.authId), account.intId);
      resolved.push({ raw: route.raw, authId: account.authId });
    }

    const { data: existing } = await supabase
      .from("event_invites")
      .select("invited_user_id, invited_email")
      .eq("event_id", eventId);
    const plan = planGuestInviteRows(resolved, existing || []);

    let inserted: { id: string; invited_user_id: string | null }[] = [];
    if (plan.insert.length > 0) {
      const { data, error: insertError } = await supabase
        .from("event_invites")
        .upsert(
          plan.insert.map((guest) => ({
            event_id: eventId,
            invited_user_id: guest.authId ?? null,
            invited_email: guest.email ?? null,
            status: "pending",
          })),
          { ignoreDuplicates: true },
        )
        .select("id, invited_user_id");
      if (insertError) {
        console.error("[event-invite-guests] insert failed:", insertError);
        return err("Could not add those guests. Try again.", 500, req);
      }
      inserted = (data || []) as typeof inserted;
    }

    // ── notify ─────────────────────────────────────────────────────────────
    const { data: hostRow } = await supabase
      .from("users")
      .select("id, username")
      .eq("auth_id", authId)
      .maybeSingle();
    const note = String(body.note || "").trim().slice(0, 240);
    const eventTitle = event.title || "an event";
    const memberIntIds = inserted
      .map((r) => (r.invited_user_id ? intIdByAuthId.get(String(r.invited_user_id)) : null))
      .filter((id): id is number => typeof id === "number");

    if (memberIntIds.length > 0) {
      const { error: notifyError } = await supabase.from("notifications").insert(
        memberIntIds.map((uid) => ({
          recipient_id: uid,
          actor_id: hostRow?.id ?? null,
          type: "event_invite",
          entity_type: "event",
          entity_id: String(eventId),
          entity_payload: {
            title: "You're on the guest list",
            body: note || `${eventTitle} — you can see it and attend.`,
          },
        })),
      );
      if (notifyError) {
        console.warn("[event-invite-guests] notification insert:", notifyError);
      }
      const { data: tokens } = await supabase
        .from("push_tokens")
        .select("token")
        .in("user_id", memberIntIds);
      if (tokens && tokens.length > 0) {
        try {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(
              tokens.map((t: any) => ({
                to: t.token,
                title: `${eventTitle}: you're on the guest list`,
                body: note || "Tap to open the event.",
                data: {
                  type: "event_invite",
                  entityType: "event",
                  entityId: String(eventId),
                  url: `${SITE_URL}/e/${eventId}`,
                },
                sound: "default",
                channelId: "default",
              })),
            ),
          });
        } catch (pushErr) {
          console.warn("[event-invite-guests] push failed:", pushErr);
        }
      }
    }

    // Email invites. The row exists either way; delivery is reported on its own
    // so a host never reads "invited" as "they got it".
    const emailTargets = plan.insert.filter((g) => !!g.email);
    const delivery = await Promise.all(
      emailTargets.map(async (guest) => {
        try {
          const messageId = await sendResendEmail({
            to: guest.email!,
            ...broadcast({
              eventTitle,
              message:
                note ||
                `You're on the guest list for ${eventTitle}. It's private, so it won't show up in search — open it with the link below.`,
              hostName: hostRow?.username ? `@${hostRow.username}` : null,
              flyerUrl: event.flyer_image_url ?? null,
              dominantColor: event.dominant_color ?? null,
              ctaUrl: `${SITE_URL}/e/${eventId}`,
              ctaLabel: "Open the event",
            }),
          });
          return messageId
            ? { recipient: guest.raw, status: "delivered" as const }
            : {
                recipient: guest.raw,
                status: "failed" as const,
                error: "Email provider not configured",
              };
        } catch (sendErr) {
          console.error("[event-invite-guests] invite email failed:", sendErr);
          return {
            recipient: guest.raw,
            status: "failed" as const,
            error: "Email delivery failed",
          };
        }
      }),
    );

    return json(
      {
        ok: true,
        data: {
          invited: inserted.length,
          already_invited: plan.alreadyInvited,
          skipped,
          delivery,
        },
      },
      200,
      req,
    );
  } catch (e: any) {
    console.error("[event-invite-guests] unexpected:", e);
    return err(e?.message || "Internal error", 500, req);
  }
});
