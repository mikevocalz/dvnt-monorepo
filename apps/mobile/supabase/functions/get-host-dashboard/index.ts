/**
 * get-host-dashboard Edge Function
 *
 * POST /get-host-dashboard
 * Body: {}
 *
 * Returns the host's multi-event command-center payload. Aggregates
 * the events the caller owns (events.host_id = authId) into:
 *   - stats: tickets sold this month / revenue this month / scan rate
 *     (% of sold tickets that were scanned, across all past events)
 *   - tonight: events with start_date in [now-2h, now+12h]
 *   - upcoming: events with start_date > now+12h, status='active'
 *   - drafts: events with status='draft' (no sales yet)
 *   - past: events with start_date < now-2h, capped at 30 rows
 *
 * All cents-only integer math. Times in UTC; client formats per locale.
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

interface DashboardEvent {
  id: number;
  title: string;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  status: string;
  total_attendees: number | null;
  capacity: number | null;
  sold_count: number;
  scanned_count: number;
  gross_cents: number;
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

    // All events this user owns
    const { data: events } = await supabase
      .from("events")
      .select(
        "id, title, start_date, end_date, cover_image_url, status, total_attendees, max_attendees",
      )
      .eq("host_id", authId)
      .order("start_date", { ascending: false });

    const eventIds = (events || []).map((e: any) => e.id);

    // Aggregate ticket data across all events in one query
    let ticketAggregates: Record<
      number,
      { sold: number; scanned: number; gross_cents: number }
    > = {};
    if (eventIds.length > 0) {
      const { data: tickets } = await supabase
        .from("tickets")
        .select("event_id, status, purchase_amount_cents")
        .in("event_id", eventIds)
        .in("status", ["active", "scanned", "transfer_pending"]);
      for (const t of tickets || []) {
        const agg =
          ticketAggregates[t.event_id] ||
          (ticketAggregates[t.event_id] = {
            sold: 0,
            scanned: 0,
            gross_cents: 0,
          });
        agg.sold += 1;
        if (t.status === "scanned") agg.scanned += 1;
        agg.gross_cents += Number(t.purchase_amount_cents || 0);
      }
    }

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twelveHoursAhead = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const decorate = (e: any): DashboardEvent => {
      const agg = ticketAggregates[e.id] || {
        sold: 0,
        scanned: 0,
        gross_cents: 0,
      };
      return {
        id: e.id,
        title: e.title,
        start_date: e.start_date,
        end_date: e.end_date,
        cover_image_url: e.cover_image_url,
        status: e.status || "active",
        total_attendees: e.total_attendees ?? null,
        capacity: e.max_attendees ?? null,
        sold_count: agg.sold,
        scanned_count: agg.scanned,
        gross_cents: agg.gross_cents,
      };
    };

    const tonight: DashboardEvent[] = [];
    const upcoming: DashboardEvent[] = [];
    const drafts: DashboardEvent[] = [];
    const past: DashboardEvent[] = [];

    for (const e of events || []) {
      const dec = decorate(e);
      const start = e.start_date ? new Date(e.start_date) : null;

      if (dec.status === "draft") {
        drafts.push(dec);
        continue;
      }
      if (dec.status === "cancelled") {
        past.push(dec);
        continue;
      }
      if (!start) {
        upcoming.push(dec);
        continue;
      }
      if (start >= twoHoursAgo && start <= twelveHoursAhead) {
        tonight.push(dec);
      } else if (start > twelveHoursAhead) {
        upcoming.push(dec);
      } else {
        past.push(dec);
      }
    }

    // Stats: this month's totals across all events
    let monthSold = 0;
    let monthRevenueCents = 0;
    let allTimeSold = 0;
    let allTimeScanned = 0;
    if (eventIds.length > 0) {
      const { data: monthTickets } = await supabase
        .from("tickets")
        .select("status, purchase_amount_cents, created_at")
        .in("event_id", eventIds)
        .gte("created_at", monthStart.toISOString())
        .neq("status", "abandoned");
      for (const t of monthTickets || []) {
        monthSold += 1;
        if (t.status !== "refunded" && t.status !== "void") {
          monthRevenueCents += Number(t.purchase_amount_cents || 0);
        }
      }
      // All-time scan rate across past events
      const pastEventIds = past.map((p) => p.id);
      if (pastEventIds.length > 0) {
        const { data: pastTickets } = await supabase
          .from("tickets")
          .select("status")
          .in("event_id", pastEventIds)
          .in("status", ["scanned", "active", "transfer_pending"]);
        for (const t of pastTickets || []) {
          allTimeSold += 1;
          if (t.status === "scanned") allTimeScanned += 1;
        }
      }
    }
    const scanRate =
      allTimeSold > 0
        ? Math.round((allTimeScanned / allTimeSold) * 100)
        : null;

    // Cap past at 30 to keep the payload small
    past.sort((a, b) => {
      const ad = a.start_date ? new Date(a.start_date).getTime() : 0;
      const bd = b.start_date ? new Date(b.start_date).getTime() : 0;
      return bd - ad;
    });
    const pastTruncated = past.slice(0, 30);

    // Sort tonight/upcoming by start_date ascending (soonest first)
    const byStart = (a: DashboardEvent, b: DashboardEvent) => {
      const ad = a.start_date ? new Date(a.start_date).getTime() : 0;
      const bd = b.start_date ? new Date(b.start_date).getTime() : 0;
      return ad - bd;
    };
    tonight.sort(byStart);
    upcoming.sort(byStart);

    return json(
      {
        ok: true,
        data: {
          ok: true,
          stats: {
            monthSold,
            monthRevenueCents,
            scanRate, // null if no past events
          },
          tonight,
          upcoming,
          drafts,
          past: pastTruncated,
        },
      },
      200,
      req,
    );
  } catch (err: any) {
    console.error("[get-host-dashboard] Unexpected:", err);
    return json(
      { ok: false, error: { message: err.message || "Internal error" } },
      500,
      req,
    );
  }
});
