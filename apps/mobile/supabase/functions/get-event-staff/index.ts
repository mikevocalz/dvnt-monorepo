/**
 * get-event-staff Edge Function
 *
 * POST /get-event-staff
 * Body: { event_id }
 *
 * Returns the full staff list for an event: the owner + every row in
 * event_co_organizers (accepted or pending). Joins users by auth_id so
 * the UI can show avatar + display name without a second round-trip.
 *
 * Read-only. Permission: owner or admin co-organizer can call this
 * (mirrors the manage-staff permission gate in invite-co-organizer).
 * Editor / scanner roles cannot see the full staff list.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(data: unknown, status = 200, req?: Request) {
  const headers = req
    ? { ...corsHeaders(req), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), { status, headers });
}

interface StaffEntry {
  inviteId: string | null;
  authId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: "owner" | "admin" | "editor" | "scanner";
  accepted: boolean;
  invitedBy: string | null;
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

    let body: { event_id?: number } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, req);
    }
    const eventId = Number(body.event_id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return json({ error: "event_id required" }, 400, req);
    }

    // Permission gate
    const { data: event } = await supabase
      .from("events")
      .select("id, host_id")
      .eq("id", eventId)
      .maybeSingle();
    if (!event) return json({ error: "Event not found" }, 404, req);

    const isOwner = String(event.host_id) === String(authId);
    let isAdmin = false;
    if (!isOwner) {
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role, accepted")
        .eq("event_id", eventId)
        .eq("user_id", authId)
        .eq("accepted", true)
        .eq("role", "admin")
        .maybeSingle();
      isAdmin = !!coOrg;
    }
    if (!isOwner && !isAdmin) {
      return json({ error: "Not authorized to view staff" }, 403, req);
    }

    // Pull co-organizer rows
    const { data: coOrgs } = await supabase
      .from("event_co_organizers")
      .select("id, user_id, role, accepted, invited_by")
      .eq("event_id", eventId);

    // Resolve all auth_ids → user metadata (one query)
    const authIds = new Set<string>();
    authIds.add(event.host_id);
    for (const c of coOrgs || []) authIds.add(c.user_id);
    const { data: userRows } = await supabase
      .from("users")
      .select("auth_id, username, first_name, last_name, avatar_id(url)")
      .in("auth_id", Array.from(authIds));
    const userByAuthId = new Map<string, any>();
    for (const u of userRows || []) {
      userByAuthId.set(u.auth_id, u);
    }

    const lookup = (aid: string): {
      username: string | null;
      displayName: string | null;
      avatarUrl: string | null;
    } => {
      const u = userByAuthId.get(aid);
      if (!u) return { username: null, displayName: null, avatarUrl: null };
      const displayName =
        [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
        u.username ||
        null;
      const avatarRaw = u.avatar_id;
      const avatarUrl =
        (Array.isArray(avatarRaw) ? avatarRaw[0]?.url : avatarRaw?.url) ??
        null;
      return {
        username: u.username ?? null,
        displayName,
        avatarUrl,
      };
    };

    const staff: StaffEntry[] = [];

    // Owner first
    const ownerInfo = lookup(event.host_id);
    staff.push({
      inviteId: null,
      authId: event.host_id,
      username: ownerInfo.username,
      displayName: ownerInfo.displayName,
      avatarUrl: ownerInfo.avatarUrl,
      role: "owner",
      accepted: true,
      invitedBy: null,
    });

    // Then co-organizers, sorted by role tier then accepted-state then id
    const ROLE_ORDER: Record<string, number> = {
      admin: 1,
      editor: 2,
      scanner: 3,
    };
    const sorted = [...(coOrgs || [])].sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 99;
      const rb = ROLE_ORDER[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      if (a.accepted !== b.accepted) return a.accepted ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
    for (const c of sorted) {
      const info = lookup(c.user_id);
      staff.push({
        inviteId: c.id,
        authId: c.user_id,
        username: info.username,
        displayName: info.displayName,
        avatarUrl: info.avatarUrl,
        role: c.role,
        accepted: c.accepted,
        invitedBy: c.invited_by,
      });
    }

    return json({ ok: true, staff, callerRole: isOwner ? "owner" : "admin" }, 200, req);
  } catch (err: any) {
    console.error("[get-event-staff] Unexpected:", err);
    return json({ error: err.message || "Internal error" }, 500, req);
  }
});
