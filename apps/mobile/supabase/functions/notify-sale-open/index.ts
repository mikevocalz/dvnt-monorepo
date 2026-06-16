/**
 * notify-sale-open Edge Function (cron dispatcher)
 *
 * Intended to be called by a scheduled cron job (pg_cron via supabase
 * cron extension, EAS workflow, or any external scheduler hitting
 * POST /notify-sale-open with a shared secret).
 *
 * Scans every event whose earliest ticket_types.sale_start has just
 * passed and dispatches Expo push notifications to each subscribed user
 * (sale_notify_subscriptions.notified_at IS NULL). Sets notified_at on
 * each subscription after a successful Expo response so we don't double-
 * send.
 *
 * Auth: header `x-cron-secret: <SALE_NOTIFY_CRON_SECRET>`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("SALE_NOTIFY_CRON_SECRET") || "";
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-cron-secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
  priority?: "high";
  channelId?: string;
}

async function sendExpoPushBatch(messages: ExpoPushMessage[]) {
  if (messages.length === 0) return { ok: true, sent: 0 };
  // Expo recommends batches of <= 100.
  const batches: ExpoPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    batches.push(messages.slice(i, i + 100));
  }
  let sent = 0;
  const failures: string[] = [];
  for (const batch of batches) {
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        failures.push(`Expo HTTP ${res.status}`);
        continue;
      }
      const tickets = result?.data ?? [];
      sent += tickets.filter((t: any) => t?.status === "ok").length;
      for (const t of tickets) {
        if (t?.status === "error") failures.push(t?.message || "Expo error");
      }
    } catch (err: any) {
      failures.push(err?.message || "fetch failed");
    }
  }
  return { ok: failures.length === 0, sent, failures };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Shared-secret auth — never expose without it.
  const provided = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    // Find events whose earliest ticket_types.sale_start has passed but
    // which still have un-notified subscribers. Single round trip via
    // an aggregate query.
    const { data: candidates, error: candErr } = await supabase
      .from("ticket_types")
      .select("event_id, sale_start, events!inner(id, title)")
      .lte("sale_start", new Date().toISOString())
      .not("sale_start", "is", null);

    if (candErr) {
      console.error("[notify-sale-open] candidates query failed:", candErr);
      return json({ error: candErr.message }, 500);
    }

    // Reduce to one earliest opened sale_start per event_id.
    const byEvent = new Map<
      number,
      { event_id: number; title: string }
    >();
    for (const row of candidates || []) {
      const eid = row.event_id as number;
      const ev = (row as any).events;
      if (!byEvent.has(eid)) {
        byEvent.set(eid, { event_id: eid, title: ev?.title || "an event" });
      }
    }

    if (byEvent.size === 0) {
      return json({ ok: true, sent: 0, events_processed: 0 });
    }

    const eventIds = Array.from(byEvent.keys());

    // Pull all un-notified subscriptions for those events + their tokens.
    const { data: subs, error: subErr } = await supabase
      .from("sale_notify_subscriptions")
      .select("id, event_id, user_id")
      .in("event_id", eventIds)
      .is("notified_at", null);

    if (subErr) {
      console.error("[notify-sale-open] subs query failed:", subErr);
      return json({ error: subErr.message }, 500);
    }

    if (!subs || subs.length === 0) {
      return json({ ok: true, sent: 0, events_processed: eventIds.length });
    }

    const userIds = Array.from(new Set(subs.map((s) => s.user_id)));
    const { data: tokens, error: tokErr } = await supabase
      .from("push_tokens")
      .select("user_id, token, platform")
      .in("user_id", userIds);

    if (tokErr) {
      console.error("[notify-sale-open] tokens query failed:", tokErr);
      return json({ error: tokErr.message }, 500);
    }

    const tokensByUser = new Map<number, string[]>();
    for (const t of tokens || []) {
      if (t.platform === "ios_voip") continue; // VoIP not for content pushes
      const list = tokensByUser.get(t.user_id) || [];
      list.push(t.token);
      tokensByUser.set(t.user_id, list);
    }

    const messages: ExpoPushMessage[] = [];
    const subIdsToMark: number[] = [];

    for (const sub of subs) {
      const ev = byEvent.get(sub.event_id);
      if (!ev) continue;
      const userTokens = tokensByUser.get(sub.user_id) || [];
      for (const token of userTokens) {
        messages.push({
          to: token,
          title: "🎟️ Tickets are live",
          body: `Sales just opened for ${ev.title}. Grab yours.`,
          sound: "default",
          priority: "high",
          channelId: "default",
          data: {
            type: "sale_open",
            event_id: ev.event_id,
            deep_link: `dvnt://events/${ev.event_id}`,
          },
        });
      }
      subIdsToMark.push(sub.id);
    }

    const result = await sendExpoPushBatch(messages);

    if (subIdsToMark.length > 0) {
      // Mark notified — we err on the side of marking even if a few Expo
      // tickets failed (the cron would otherwise re-send the same push
      // repeatedly, much worse UX than missing a single delivery).
      const { error: markErr } = await supabase
        .from("sale_notify_subscriptions")
        .update({ notified_at: new Date().toISOString() })
        .in("id", subIdsToMark);
      if (markErr) {
        console.error("[notify-sale-open] mark notified failed:", markErr);
      }
    }

    return json({
      ok: result.ok,
      sent: result.sent,
      events_processed: byEvent.size,
      subscriptions_marked: subIdsToMark.length,
      failures: result.failures,
    });
  } catch (err: any) {
    console.error("[notify-sale-open] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
