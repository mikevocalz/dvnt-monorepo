/** Lists verified live Lynks and recent ended history. V2 also includes authorized
 * owner/invite management rows, explicitly marked inactive/scheduled/ended. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { readAllRows } from "../_shared/read-all-rows.ts";
import { hasEventRoomAdmission } from "../_shared/event-access.ts";
import {
  buildRoomPresence, HEARTBEAT_FRESHNESS_MS, resolveListAvailability, resolveListEventLink,
} from "../_shared/lynk-list-availability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_SELECT = "id, lynk_room_id, host_id, visibility, status, ticketing_enabled, start_date, end_date";
const LIFECYCLE_SELECT = "event_id, room_uuid, state";
function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function errorResponse(code: string, message: string): Response {
  return jsonResponse({ ok: false, error: { code, message } });
}

/** Two complete scans may return the same row. Do not silently choose between
 * contradictory snapshots or duplicate primary keys returned by a page. */
function mergeRows(first: any[], second: any[], key: string): any[] {
  const result = new Map(first.map((row) => [row[key], row]));
  for (const row of second) {
    const previous = result.get(row[key]);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("Conflicting linked event rows");
    result.set(row[key], row);
  }
  return [...result.values()];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("validation_error", "Method not allowed");
  try {
    if (!req.headers.get("Authorization")?.startsWith("Bearer ")) {
      return errorResponse("unauthorized", "Missing or invalid Authorization header");
    }
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });
    const sessionResult = await verifySessionDetailed(supabase, req);
    if (!sessionResult.ok) return errorResponse("unauthorized", sessionResult.reason === "expired" ? "Session expired" : "Invalid or expired session");
    let body: any;
    try {
      const raw = await req.text();
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return errorResponse("validation_error", "Invalid request body");
    }
    // Old clients derive joinability from raw status. Only numeric v2 opts in.
    const management = body?.discoveryVersion === 2;
    const userId = String(sessionResult.userId);
    const queryNow = Date.now();
    const recent = new Date(queryNow - DAY_MS).toISOString();
    const roomStatusFilter = `status.eq.open,and(status.eq.ended,ended_at.gte.${recent})`;

    // Filter host presence BEFORE the public 50-room limit. Otherwise 50 stale
    // open rows can hide an older genuinely live room. This is only a candidate
    // filter: the complete membership scan below rejects superseded hosts.
    // Discovery is deliberately bounded: later access/deadline/event filtering
    // can leave fewer than 50 results and does not refill from older candidates.
    const { data: liveCandidates, error: liveError } = await supabase.from("video_rooms")
      .select("*, presence:video_room_members!inner(id)")
      .eq("is_public", true).eq("room_kind", "lynk").eq("status", "open")
      .eq("presence.status", "active").is("presence.left_at", null)
      .in("presence.role", ["host", "co-host"])
      .gt("presence.last_seen_at", new Date(queryNow - HEARTBEAT_FRESHNESS_MS).toISOString())
      .lte("presence.last_seen_at", new Date(queryNow).toISOString())
      .order("created_at", { ascending: false }).limit(50);
    if (liveError || !Array.isArray(liveCandidates)) throw new Error("Could not load live rooms");
    const { data: endedCandidates, error: endedError } = await supabase.from("video_rooms").select("*")
      .eq("is_public", true).eq("room_kind", "lynk").eq("status", "ended")
      .gte("ended_at", recent).order("ended_at", { ascending: false }).limit(50);
    if (endedError || !Array.isArray(endedCandidates)) throw new Error("Could not load room history");
    const invites = await readAllRows(() => supabase.from("video_room_invites").select("id, room_id").eq("user_id", userId));
    const invitedIds = [...new Set(invites.map((invite) => invite.room_id))];
    const rooms = new Map<number, any>();
    for (const room of [...liveCandidates, ...endedCandidates]) rooms.set(room.id, room);
    if (invitedIds.length) {
      const { data, error } = await supabase.from("video_rooms").select("*")
        .in("id", invitedIds).eq("room_kind", "lynk").or(roomStatusFilter)
        .order("created_at", { ascending: false }).limit(50);
      if (error || !Array.isArray(data)) throw new Error("Could not load invited rooms");
      for (const room of data) rooms.set(room.id, room);
    }
    const { data: owned, error: ownedError } = await supabase.from("video_rooms").select("*")
      .eq("created_by", userId).eq("room_kind", "lynk").or(roomStatusFilter)
      .order("created_at", { ascending: false }).limit(50);
    if (ownedError || !Array.isArray(owned)) throw new Error("Could not load owned rooms");
    for (const room of owned) rooms.set(room.id, room);
    if (!rooms.size) return jsonResponse({ ok: true, data: { rooms: [] } });

    const roomIds = [...rooms.keys()];
    const uuids = [...rooms.values()].map((room) => room.uuid).filter(Boolean);
    const members = await readAllRows(() => supabase.from("video_room_members")
      .select("id, room_id, user_id, role, status, last_seen_at, left_at").in("room_id", roomIds));
    let events: any[] = [];
    let lifecycles: any[] = [];
    if (uuids.length) {
      events = await readAllRows(() => supabase.from("events").select(EVENT_SELECT).in("lynk_room_id", uuids));
      // lifecycle has event_id as its primary key, not id. A capped first page
      // must never hide a second room's lifecycle-only (orphan) event binding.
      lifecycles = await readAllRows(() => supabase.from("event_lynk_lifecycle")
        .select(LIFECYCLE_SELECT).in("room_uuid", uuids), { cursorColumn: "event_id" });
      const reverseEventIds = [...new Set(lifecycles.map((row) => row.event_id))];
      const directEventIds = events.map((event) => event.id);
      if (reverseEventIds.length) events = mergeRows(events, await readAllRows(() => supabase.from("events")
        .select(EVENT_SELECT).in("id", reverseEventIds)), "id");
      if (directEventIds.length) lifecycles = mergeRows(lifecycles, await readAllRows(() => supabase.from("event_lynk_lifecycle")
        .select(LIFECYCLE_SELECT).in("event_id", directEventIds), { cursorColumn: "event_id" }), "event_id");
    }
    const eventIds = events.map((event) => event.id);
    let staff: any[] = [], tickets: any[] = [], guestInvites: any[] = [];
    if (eventIds.length) {
      [staff, tickets, guestInvites] = await Promise.all([
        readAllRows(() => supabase.from("event_co_organizers").select("id, event_id, accepted")
          .in("event_id", eventIds).eq("user_id", userId)),
        readAllRows(() => supabase.from("tickets").select("id, event_id")
          .in("event_id", eventIds).eq("user_id", userId).in("status", ["active", "scanned"]).eq("category", "admission")),
        readAllRows(() => supabase.from("event_invites").select("id, event_id")
          .in("event_id", eventIds).eq("invited_user_id", userId).in("status", ["pending", "accepted"])),
      ]);
    }
    const invited = new Set(invitedIds);
    const eligible = [];
    for (const room of rooms.values()) {
      const link = resolveListEventLink(String(room.uuid ?? ""), events, lifecycles);
      if (link.kind === "invalid") continue;
      if (link.kind === "linked") {
        const { event } = link;
        if (["cancelled", "deleted"].includes(event.status ?? "")) continue;
        const access = {
          organizer: event.host_id === userId || staff.some((row) => row.event_id === event.id && row.accepted === true),
          ticket: tickets.some((row) => row.event_id === event.id),
          invited: guestInvites.some((row) => row.event_id === event.id) || staff.some((row) => row.event_id === event.id),
        };
        if (!hasEventRoomAdmission(event, access)) continue;
      }
      const isOwner = room.created_by === userId;
      const isInvited = invited.has(room.id);
      if (!room.is_public && !isOwner && !isInvited) continue;
      eligible.push({ room, link, isOwner, isInvited });
    }
    const creatorIds = [...new Set(eligible.map(({ room }) => room.created_by).filter(Boolean))];
    const creators = creatorIds.length ? await readAllRows(() => supabase.from("users")
      .select("id, auth_id, username, first_name, avatar:avatar_id(url), verified").in("auth_id", creatorIds)) : [];
    // Observe after ALL reads; a heartbeat can expire even during profile
    // hydration. This is a bounded scan, not a transaction snapshot.
    const now = Date.now();
    const presence = buildRoomPresence(members, now);
    const visible = eligible.map((entry) => ({
      ...entry, availability: resolveListAvailability(entry.room, presence.get(entry.room.id), entry.link, now),
    })).filter(({ room, availability, isOwner, isInvited }) => {
      const ended = Date.parse(room.ended_at ?? "");
      const recentHistory = room.status === "ended" && Number.isFinite(ended) && ended <= now && now - ended <= DAY_MS;
      // An expired raw-open room is not persisted ended history. Legacy clients
      // must never receive it, even if they own it or have a room invitation.
      return availability.availability === "live" || recentHistory || (management && (isOwner || isInvited));
    });
    const creatorsById = new Map(creators.map((creator) => [creator.auth_id, creator]));
    visible.sort((a, b) => Number(b.availability.availability === "live") - Number(a.availability.availability === "live") ||
      Date.parse(b.room.created_at ?? "") - Date.parse(a.room.created_at ?? ""));
    return jsonResponse({ ok: true, data: { rooms: visible.map(({ room, link, availability, isOwner, isInvited }) => {
      const creator = creatorsById.get(room.created_by);
      const stats = presence.get(room.id);
      return {
        id: room.uuid || String(room.id), createdBy: room.created_by || "",
        title: room.title || "Untitled Lynk", topic: room.topic || "", description: room.description || "",
        sweetSpicyMode: room.sweet_spicy_mode || "sweet", ...availability,
        isLive: availability.availability === "live", isOwner, isInvited,
        hasVideo: room.has_video ?? false, isPublic: room.is_public ?? true,
        status: room.status, createdAt: room.created_at, endedAt: room.ended_at || undefined,
        host: {
          id: String(creator?.id || ""), username: creator?.username || "unknown",
          displayName: creator?.first_name || creator?.username || "unknown",
          avatar: creator?.avatar?.url || "", isVerified: creator?.verified || false,
        },
        speakers: [], listeners: room.status === "ended" ? stats?.historicalCount ?? 0 : stats?.activeCount ?? 0,
        maxParticipants: room.max_participants || 50, fishjamRoomId: room.fishjam_room_id || undefined,
        ...(link.kind === "linked" ? { eventId: link.event.id, scheduledStart: link.event.start_date, scheduledEnd: link.event.end_date } : {}),
      };
    }) } });
  } catch (error) {
    console.error("[video_list_rooms] Read failed:", error);
    return errorResponse("internal_error", "Could not verify room availability");
  }
});
