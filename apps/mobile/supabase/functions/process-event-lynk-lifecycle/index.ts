/**
 * Edge Function: process-event-lynk-lifecycle
 *
 * Cron sweep (every 5 min via cron_event_lynk_lifecycle_sweep, which sends
 * x-cron-secret). For every event that owns a Lynk room it syncs the
 * event_lynk_lifecycle row and ends the room once the event ends or is
 * cancelled.
 *
 * It never opens a room. A room goes live only when a host starts it
 * (event-lynk-room, action "start"), and sync_event_lynk_lifecycle keeps a
 * host-started row live until the event ends.
 *
 * Auth: header `x-cron-secret: <CRON_SECRET>`, the same Vault-backed
 * dispatcher shape as event-reminders. Fails closed when CRON_SECRET is unset.
 *
 * A row that fails is logged and reported, and the sweep keeps going so one
 * bad event cannot stall the rest. Any failure makes the response 500, which
 * is what net._http_response records for the cron run.
 */

import { decideEventRoomAccess } from "../_shared/event-access.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!CRON_SECRET) {
    console.error(
      "[process-event-lynk-lifecycle] CRON_SECRET not set, rejecting request",
    );
    return json({ error: "misconfigured" }, 500);
  }
  if ((req.headers.get("x-cron-secret") || "") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const s = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let changed = 0;
  let checked = 0;
  let cursor = 0;
  const PAGE_SIZE = 500;
  const failed: number[] = [];
  const fail = (id: number, step: string, detail: unknown) => {
    console.error(
      `[process-event-lynk-lifecycle] event ${id} ${step} failed:`,
      detail,
    );
    if (!failed.includes(id)) failed.push(id);
  };

  // Keyset pagination prevents the oldest linked events from permanently
  // consuming the first 500 slots. Each query is bounded and advances by id,
  // so deletion/relinking between pages cannot shift offsets and skip rows.
  while (true) {
    const { data: events, error } = await s.from("events")
      .select("id,lynk_room_id,start_date,end_date,status")
      .not("lynk_room_id", "is", null).gt("id", cursor)
      .order("id", { ascending: true }).limit(PAGE_SIZE);
    if (error) {
      console.error("[process-event-lynk-lifecycle] event page failed:", error);
      return json({ ok: false, error: error.message, checked, changed, failed }, 500);
    }
    if (!events?.length) break;
    checked += events.length;
    for (const e of events || []) {
      const { data: synced, error: syncError } = await s.rpc(
        "sync_event_lynk_lifecycle",
        { p_event_id: e.id },
      );
      if (syncError) {
        fail(e.id, "sync_event_lynk_lifecycle", syncError);
        continue;
      }
      if (synced && (synced as { ok?: boolean }).ok === false) {
        fail(e.id, "sync_event_lynk_lifecycle", synced);
        continue;
      }

      const { data: room, error: roomError } = await s.from("video_rooms")
        .select("status,created_at,ends_at").eq("uuid", e.lynk_room_id).maybeSingle();
      if (roomError || !room) {
        fail(e.id, "read room", roomError || "Room missing");
        continue;
      }
      // The same shifted plan window guards wait, start, join and token refresh.
      // Treat the host as admitted here: this sweep only closes, never starts.
      const decision = decideEventRoomAccess(
        { ...e, host_id: "" }, { organizer: true, ticket: false, invited: false },
        room, Date.now(), true,
      );
      if (!decision.ok && decision.detail.reason === "event_schedule_missing") {
        fail(e.id, "schedule", decision.message);
        continue;
      }
      if (!decision.ok) {
        const { data: didEnd, error: endError } = await s.rpc("expire_event_lynk_room", { p_event_id: e.id });
        if (endError) fail(e.id, "expire room", endError);
        else if (didEnd === true) changed++;
      }
    }
    cursor = events[events.length - 1].id;
    if (events.length < PAGE_SIZE) break;
  }

  const body = { ok: failed.length === 0, checked, changed, failed };
  return json(body, failed.length ? 500 : 200);
});
