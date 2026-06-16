/**
 * Host Transactions Edge Function
 *
 * POST /host-transactions
 * Body: { action: "list", event_id?, type?, cursor? }
 *
 * Returns balance transaction ledger for organizers.
 * Combines data from:
 *   - tickets table (charges)
 *   - refund_requests (refunds)
 *   - payouts (payout transfers)
 *   - event_financials (fee records)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });
    const userId = await verifySession(supabase, req);
    if (!userId) return errorResponse("Unauthorized", 401);

    // Verify organizer
    const { data: orgAccount } = await supabase
      .from("organizer_accounts")
      .select("stripe_account_id")
      .eq("host_id", userId)
      .single();

    if (!orgAccount?.stripe_account_id) {
      return errorResponse("Not an organizer", 403);
    }

    const body = await req.json();
    const { action, event_id, type: txnType } = body;

    if (action !== "list") return errorResponse(`Unknown action: ${action}`);

    // ── Build transactions from multiple sources ──────────

    const transactions: any[] = [];

    // 1. Ticket sales (charges) — from orders table
    let ordersQuery = supabase
      .from("orders")
      .select(
        "id, total_cents, platform_fee_cents, processing_fee_cents, created_at, event_id, events(title)",
      )
      .in("status", ["paid", "partially_refunded", "refunded"]);

    // Filter: orders where the event belongs to this host
    const { data: hostEvents } = await supabase
      .from("events")
      .select("id, title")
      .eq("host_id", userId);

    const hostEventIds = (hostEvents || []).map((e: any) => e.id);
    const eventTitleMap: Record<number, string> = {};
    (hostEvents || []).forEach((e: any) => {
      eventTitleMap[e.id] = e.title;
    });

    if (hostEventIds.length === 0) {
      return jsonResponse({ data: [], hasMore: false });
    }

    if (event_id) {
      const parsedEventId = parseInt(event_id);
      if (isNaN(parsedEventId)) return errorResponse("Invalid event_id", 400);
      if (!hostEventIds.includes(parsedEventId)) {
        return errorResponse("Event not found or not yours", 404);
      }
      ordersQuery = ordersQuery.eq("event_id", parsedEventId);
    } else {
      ordersQuery = ordersQuery.in("event_id", hostEventIds);
    }

    const { data: orders } = await ordersQuery
      .order("created_at", { ascending: false })
      .limit(100);

    if (!txnType || txnType === "charge") {
      for (const o of orders || []) {
        transactions.push({
          id: `charge-${o.id}`,
          type: "charge",
          description: `Ticket sale`,
          amountCents: o.total_cents || 0,
          feeCents: (o.platform_fee_cents || 0) + (o.processing_fee_cents || 0),
          netCents:
            (o.total_cents || 0) -
            (o.platform_fee_cents || 0) -
            (o.processing_fee_cents || 0),
          currency: "usd",
          eventId: o.event_id?.toString(),
          eventTitle: eventTitleMap[o.event_id] || o.events?.title || "",
          createdAt: o.created_at,
        });
      }
    }

    // 2. Platform fees (derived from orders)
    if (!txnType || txnType === "fee") {
      for (const o of orders || []) {
        if ((o.platform_fee_cents || 0) > 0) {
          transactions.push({
            id: `fee-${o.id}`,
            type: "fee",
            description: "Platform fee",
            amountCents: -(o.platform_fee_cents || 0),
            feeCents: 0,
            netCents: -(o.platform_fee_cents || 0),
            currency: "usd",
            eventId: o.event_id?.toString(),
            eventTitle: eventTitleMap[o.event_id] || "",
            createdAt: o.created_at,
          });
        }
      }
    }

    // 3. Refunds — from refund_requests
    if (!txnType || txnType === "refund") {
      let refundQuery = supabase
        .from("refund_requests")
        .select("id, amount_cents, created_at, order_id, orders(event_id)")
        .eq("status", "processed")
        .order("created_at", { ascending: false })
        .limit(50);

      const { data: refunds } = await refundQuery;

      for (const r of refunds || []) {
        const eventId = r.orders?.event_id;
        if (eventId && hostEventIds.includes(eventId)) {
          if (!event_id || parseInt(event_id) === eventId) {
            transactions.push({
              id: `refund-${r.id}`,
              type: "refund",
              description: "Refund issued",
              amountCents: -(r.amount_cents || 0),
              feeCents: 0,
              netCents: -(r.amount_cents || 0),
              currency: "usd",
              eventId: eventId?.toString(),
              eventTitle: eventTitleMap[eventId] || "",
              createdAt: r.created_at,
            });
          }
        }
      }
    }

    // 4. Payouts
    if (!txnType || txnType === "payout") {
      let payoutQuery = supabase
        .from("payouts")
        .select(
          "id, net_amount_cents, platform_fee_cents, created_at, event_id, events(title)",
        )
        .eq("host_id", userId)
        .eq("status", "paid")
        .order("created_at", { ascending: false })
        .limit(50);

      if (event_id) {
        payoutQuery = payoutQuery.eq("event_id", parseInt(event_id));
      }

      const { data: payouts } = await payoutQuery;

      for (const p of payouts || []) {
        transactions.push({
          id: `payout-${p.id}`,
          type: "payout",
          description: "Payout to bank",
          amountCents: -(p.net_amount_cents || 0),
          feeCents: 0,
          netCents: -(p.net_amount_cents || 0),
          currency: "usd",
          eventId: p.event_id?.toString(),
          eventTitle: p.events?.title || eventTitleMap[p.event_id] || "",
          createdAt: p.created_at,
        });
      }
    }

    // Sort by date descending
    transactions.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return jsonResponse({ data: transactions.slice(0, 100), hasMore: false });
  } catch (err: any) {
    console.error("[host-transactions] Error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
