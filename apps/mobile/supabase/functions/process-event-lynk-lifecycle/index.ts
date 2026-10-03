/**
 * Edge Function: process-event-lynk-lifecycle
 *
 * Cron sweep (every 5 min via cron_event_lynk_lifecycle_sweep, which sends
 * x-cron-secret). For every event that owns a Lynk room it syncs the
 * event_lynk_lifecycle row, opens a scheduled room once the event starts,
 * and ends the room once the event ends or is cancelled.
 *
 * Auth: header `x-cron-secret: <CRON_SECRET>`, the same Vault-backed
 * dispatcher shape as event-reminders. Fails closed when CRON_SECRET is unset.
 *
 * A row that fails is logged and reported, and the sweep keeps going so one
 * bad event cannot stall the rest. Any failure makes the response 500, which
 * is what net._http_response records for the cron run.
 */

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
  const { data: events, error } = await s
    .from("events")
    .select("id,lynk_room_id,start_date,end_date,status")
    .not("lynk_room_id", "is", null)
    .limit(500);
  if (error) {
    console.error("[process-event-lynk-lifecycle] event query failed:", error);
    return json({ ok: false, error: error.message }, 500);
  }

  let changed = 0;
  const failed: number[] = [];
  const fail = (id: number, step: string, detail: unknown) => {
    console.error(
      `[process-event-lynk-lifecycle] event ${id} ${step} failed:`,
      detail,
    );
    if (!failed.includes(id)) failed.push(id);
  };

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

    const start = new Date(e.start_date).getTime();
    const end = e.end_date
      ? new Date(e.end_date).getTime()
      : start + 6 * 60 * 60 * 1000;
    const now = Date.now();
    if (["cancelled", "deleted"].includes(e.status) || now >= end) {
      const { data: r, error: endError } = await s
        .from("video_rooms")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("uuid", e.lynk_room_id)
        .neq("status", "ended")
        .select("id")
        .maybeSingle();
      if (endError) fail(e.id, "end room", endError);
      else if (r) changed++;
    } else if (now >= start) {
      // A pre-created event room becomes eligible to appear live at start.
      // Actual isLive still requires fresh host presence.
      const { data: r, error: openError } = await s
        .from("video_rooms")
        .update({ status: "open" })
        .eq("uuid", e.lynk_room_id)
        .eq("status", "scheduled")
        .select("id")
        .maybeSingle();
      if (openError) fail(e.id, "open room", openError);
      else if (r) changed++;
    }
  }

  const body = { ok: failed.length === 0, checked: (events || []).length, changed, failed };
  return json(body, failed.length ? 500 : 200);
});
