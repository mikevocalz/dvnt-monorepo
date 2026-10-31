/**
 * Edge Function: event-reminders
 *
 * Cron sweep (every 15 min via cron_event_reminder_sweep → x-cron-secret).
 * About three hours before an event starts, eligible tickets are grouped
 * into recipient reminders: flyer, event details, and ticket links — the same
 * ticketConfirmation layout as the purchase email, so the reminder
 * provides secure links to the current ticket at the door.
 *
 * Durable per-ticket bundles prevent overlapping sweeps and retries from
 * duplicating reminders. Late tickets in the original band get a new bundle.
 *
 * Auth: header `x-cron-secret: <CRON_SECRET>` (Vault-backed dispatcher,
 * same pattern as cron_reconcile_orders).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deliverEventReminders } from "../_shared/event-reminder-delivery.ts";

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
    console.error("[event-reminders] CRON_SECRET not set — rejecting request");
    return json({ error: "misconfigured" }, 500);
  }
  if ((req.headers.get("x-cron-secret") || "") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const now = Date.now();
  // Events starting in a 60-min band centred on now+3h. The sweep runs
  // every 15 min: an event can appear in several consecutive sweeps.
  const windowStart = new Date(now + 150 * 60_000).toISOString();
  const windowEnd = new Date(now + 210 * 60_000).toISOString();

  const events: any[] = [];
  const seenEvents = new Set<number>();
  const reservationDeadline = now + 30_000;
  // Keyset pagination avoids offset shifts as other events change. An empty
  // page alone ends traversal even when the server cap is below 200.
  for (let cursor: number | null = null; ; ) {
    let query = supabase.from("events")
      .select("id,status")
      .gte("start_date", windowStart).lt("start_date", windowEnd)
      .order("id", {ascending: true}).range(0, 199);
    if (cursor !== null) query = query.gt("id", cursor);
    const {data: page, error} = await query;
    if (error) return json({error: "event query failed"}, 500);
    if (!page?.length) break;
    if (page.some((ev: any) => seenEvents.has(ev.id))) return json({error: "event pagination made no progress"}, 500);
    for (const ev of page) seenEvents.add(ev.id);
    events.push(...page);
    if (Date.now() >= reservationDeadline) break;
    cursor = page[page.length - 1].id;
  }

  let failed = 0;
  // Event flags remain compatibility metadata, not eligibility gates. A newly
  // issued ticket inside this same band must still receive its own reminder.
  for (const ev of events ?? []) {
    if (Date.now() >= reservationDeadline) break;
    if (["cancelled", "canceled", "deleted"].includes(String(ev.status))) continue;
    try {
      const reservedIds = new Set<string>();
      while (Date.now() < reservationDeadline) {
        const reserved = await supabase.rpc("reserve_event_reminders", {p_event_id: ev.id, p_limit: 100});
        if (reserved.error) throw new Error("Reminder reservation unavailable");
        if (!reserved.data?.length) break;
        if (reserved.data.some((row: any) => reservedIds.has(row.id))) throw new Error("Reminder reservation made no progress");
        for (const row of reserved.data) reservedIds.add(row.id);
      }
    } catch {
      failed++;
      console.error("[event-reminders] reservation failed");
    }
  }
  try {
    const results: Awaited<ReturnType<typeof deliverEventReminders>> = [];
    const drainDeadline = Date.now() + 90_000;
    do {
      const batch = await deliverEventReminders(supabase);
      results.push(...batch);
      if (!batch.length) break;
    } while (Date.now() < drainDeadline);
    return json({ok: true, events_seen: (events ?? []).length,
      events_completed: [], // Partial accepted batches do not establish event completion.
      events_processed: [...new Set(results.map(r => r.event_id))],
      emails_sent: results.filter(r => r.status === "delivered").length,
      emails_unavailable: results.filter(r => r.status === "not_available").length,
      emails_failed: failed + results.filter(r => r.status === "failed").length});
  } catch {
    return json({error: "reminder delivery unavailable"}, 500);
  }
});
