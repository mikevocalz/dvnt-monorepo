/**
 * Edge Function: event-lynk-room
 *
 * The waiting room in front of an event's Sneaky Lynk, modelled on Zoom: the
 * room opens when a host starts it, and nobody else gets in before that.
 *
 *   action "wait"  (any eligible guest, body { room_id })
 *     A host who calls "wait" (opens their own room) starts it, as Zoom does
 *     when the host joins: same lifecycle change as "start", idempotent.
 *     Before the host starts, records the caller in event_lynk_waiting and
 *     answers { state: "scheduled", admitted: false }. Clients call it every
 *     WAIT_HEARTBEAT_MS while they sit in the waiting room. Once the room is
 *     live it answers { admitted: true } and the client calls video_join_room,
 *     which still applies bans, capacity and verified admission.
 *
 *   action "list"  (host only, body { event_id })
 *     Lifecycle state plus the guests seen in the last WAITING_FRESH_MS.
 *
 *   action "start" (host only, body { event_id })
 *     scheduled/ready -> live. Idempotent: a second start answers 200 with
 *     started: false. Refused for a cancelled or ended event and for a room
 *     that has ended. Marks every waiting guest admitted; it never writes
 *     video_room_members, so starting cannot skip the join path's gates.
 *
 * "Host" is _shared/event-lynk-host.ts: owner or accepted admin/editor
 * co-organizer. Every read that decides access fails closed with a 500.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { eventRelationships, decideEventRoomAccess } from "../_shared/event-access.ts";
import { isEventLynkHost } from "../_shared/event-lynk-host.ts";
import { startEventLynk } from "../_shared/event-lynk-start.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Clients heartbeat "wait" this often; the client mirror polls at the same rate. */
export const WAIT_HEARTBEAT_MS = 5_000;
/** A guest not seen for this long has left the waiting room. */
export const WAITING_FRESH_MS = 30_000;
const EVENT_COLUMNS =
  "id,host_id,visibility,status,ticketing_enabled,start_date,end_date,lynk_room_id";

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
const fail = (req: Request, status: number, error: string, reason?: string, extra: Record<string, unknown> = {}) =>
  json(req, { ok: false, error, ...(reason ? { reason } : {}), ...extra }, status);

class ReadError extends Error {}

async function lifecycleState(db: any, eventId: number): Promise<string> {
  const { data, error } = await db.from("event_lynk_lifecycle").select("state")
    .eq("event_id", eventId).maybeSingle();
  if (error) throw new ReadError("lifecycle");
  return data?.state || "scheduled";
}

async function handleWait(req: Request, db: any, actor: string, body: any) {
  const roomId = typeof body.room_id === "string" ? body.room_id : "";
  if (!roomId) return fail(req, 400, "room_id required");
  const { data: events, error } = await db.from("events").select(EVENT_COLUMNS)
    .eq("lynk_room_id", roomId).limit(2);
  if (error || (events?.length ?? 0) > 1) throw new ReadError("event");
  const event = events?.[0];
  if (!event) return fail(req, 404, "Event Lynk not found", "not_found");

  const state = await lifecycleState(db, event.id);
  const access = await eventRelationships(db, event, actor);
  const decision = decideEventRoomAccess(event, access, {}, Date.now(), state === "live");
  if (decision.ok) {
    // A host opening their own room starts it. An organizer who is not a
    // host (a scanner) gets in without starting anything.
    if (state !== "live" && access.organizer) {
      let host: boolean;
      try {
        host = await isEventLynkHost(db, event, actor);
      } catch {
        throw new ReadError("host");
      }
      if (host) {
        const result = await startEventLynk(db, event, actor);
        if (!result.ok) {
          return fail(req, 409, result.message, result.reason, result.state ? { state: result.state } : {});
        }
        return json(req, { ok: true, state: "live", admitted: true, started: result.started });
      }
    }
    return json(req, { ok: true, state, admitted: true });
  }

  const reason = String(decision.detail.reason);
  if (reason !== "waiting_for_host") {
    return fail(req, decision.code === "forbidden" ? 403 : 409, decision.message, reason);
  }
  // Insert sets joined_at; a heartbeat only moves last_seen_at.
  const { error: upsertError } = await db.from("event_lynk_waiting").upsert(
    { event_id: event.id, user_id: actor, last_seen_at: new Date().toISOString() },
    { onConflict: "event_id,user_id" },
  );
  if (upsertError) throw new ReadError("waiting upsert");
  return json(req, {
    ok: true, state, admitted: false, startsAt: event.start_date,
    pollMs: WAIT_HEARTBEAT_MS,
  });
}

async function loadHostedEvent(req: Request, db: any, actor: string, body: any) {
  const eventId = Number(body.event_id);
  if (!Number.isInteger(eventId) || eventId <= 0) return { res: fail(req, 400, "event_id required") };
  const { data: event, error } = await db.from("events").select(EVENT_COLUMNS)
    .eq("id", eventId).maybeSingle();
  if (error) throw new ReadError("event");
  if (!event?.lynk_room_id) return { res: fail(req, 404, "Event Lynk not found", "not_found") };
  let host: boolean;
  try {
    host = await isEventLynkHost(db, event, actor);
  } catch {
    throw new ReadError("host");
  }
  if (!host) return { res: fail(req, 403, "Only a host can do this", "not_host") };
  return { event };
}

async function handleList(req: Request, db: any, actor: string, body: any) {
  const { res, event } = await loadHostedEvent(req, db, actor, body);
  if (res) return res;
  const state = await lifecycleState(db, event.id);
  const since = new Date(Date.now() - WAITING_FRESH_MS).toISOString();
  const { data: rows, error } = await db.from("event_lynk_waiting")
    .select("user_id,joined_at,last_seen_at").eq("event_id", event.id)
    .is("admitted_at", null).gte("last_seen_at", since)
    .order("joined_at", { ascending: true }).limit(200);
  if (error) throw new ReadError("waiting list");
  const ids = (rows || []).map((r: any) => String(r.user_id));
  const profiles = new Map<string, any>();
  if (ids.length) {
    const { data: users, error: usersError } = await db.from("users")
      .select("auth_id,username,first_name,last_name,avatar:avatar_id(url)")
      .in("auth_id", ids);
    if (usersError) throw new ReadError("users");
    for (const u of users || []) profiles.set(String(u.auth_id), u);
  }
  const waiting = (rows || []).map((r: any) => {
    const u = profiles.get(String(r.user_id));
    const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim();
    return {
      userId: String(r.user_id),
      username: u?.username ?? null,
      displayName: name || u?.username || null,
      avatar: u?.avatar?.url ?? null,
      joinedAt: r.joined_at,
    };
  });
  return json(req, { ok: true, state, count: waiting.length, waiting });
}

async function handleStart(req: Request, db: any, actor: string, body: any) {
  const { res, event } = await loadHostedEvent(req, db, actor, body);
  if (res) return res;
  let result;
  try {
    result = await startEventLynk(db, event, actor);
  } catch (err) {
    throw new ReadError((err as Error).message);
  }
  if (!result.ok) {
    return fail(req, 409, result.message, result.reason, result.state ? { state: result.state } : {});
  }
  return json(req, { ok: true, state: "live", started: result.started, admitted: result.admitted });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return fail(req, 405, "Method not allowed");
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const actor = await verifySession(db, req);
  if (!actor) return fail(req, 401, "Unauthorized");
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "wait") return await handleWait(req, db, actor, body);
    if (body.action === "list") return await handleList(req, db, actor, body);
    if (body.action === "start") return await handleStart(req, db, actor, body);
    return fail(req, 400, "Unknown action");
  } catch (err) {
    console.error("[event-lynk-room] read failed:", (err as Error).message);
    return fail(req, 500, "Could not verify the event room");
  }
});
