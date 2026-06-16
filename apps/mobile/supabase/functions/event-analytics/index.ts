/**
 * Event Analytics Edge Function
 *
 * POST /event-analytics
 * Body:
 *   { event_id }                              → analytics summary
 *   { event_id, action: "attendees" }         → flat attendee list for CSV
 *
 * Both actions are host-only (events.host_id === authId).
 *
 * The summary action returns:
 *   - revenue       : gross / dvnt fee / stripe fee / net cents (from event_financials)
 *   - tickets       : total, active, checked_in, refunded, void, transfer_pending
 *   - tiers         : per-tier sold/remaining/revenue
 *   - promoCodes    : code usage stats (top 5 by uses)
 *
 * The attendees action returns one row per ticket with denormalized buyer
 * info (username, email, name, tier, status, purchase amount, check-in
 * timestamp). Designed to be CSV-serialized client-side and shared.
 *
 * This function intentionally does NOT hit Stripe — all numbers come from
 * Supabase tables that are already maintained by webhooks + triggers, so
 * the response is fast and dependable even when Stripe is flaky.
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

    const authId = await verifySession(supabase, req);
    if (!authId) return errorResponse("Unauthorized", 401);

    let body: { event_id?: string | number; action?: string } = {};
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const eventIdNum = Number(body.event_id);
    if (!Number.isFinite(eventIdNum) || eventIdNum <= 0) {
      return errorResponse("event_id required", 400);
    }

    const action = (body.action || "summary").toString();

    // Host check — only the event owner can see analytics
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("id, host_id, title")
      .eq("id", eventIdNum)
      .maybeSingle();

    if (eventErr) {
      console.error("[event-analytics] event lookup error:", eventErr);
      return errorResponse("Event lookup failed", 500);
    }
    if (!event) return errorResponse("Event not found", 404);

    const isHost = String(event.host_id) === String(authId);
    if (!isHost) {
      // Allow accepted co-organizers with admin role to view analytics
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role")
        .eq("event_id", eventIdNum)
        .eq("user_id", authId)
        .eq("accepted", true)
        .in("role", ["admin"])
        .maybeSingle();

      if (!coOrg) return errorResponse("Not your event", 403);
    }

    // ── action: attendees ────────────────────────────────────
    // Returns the flat attendee list for CSV export. Joined with the
    // user + ticket_type tables so the host gets human-readable rows
    // without an N+1 client-side merge.
    if (action === "attendees") {
      const { data: attendeeRows, error: attendeeErr } = await supabase
        .from("tickets")
        .select(
          `
          id,
          status,
          purchase_amount_cents,
          checked_in_at,
          created_at,
          guest_email,
          ticket_type:ticket_types(name, price_cents),
          buyer:users!tickets_user_id_fkey(username, email, first_name, last_name)
        `,
        )
        .eq("event_id", eventIdNum)
        .order("created_at", { ascending: true });

      if (attendeeErr) {
        // Fall back to a narrower select if the join shape is missing
        // (e.g. older databases where the FK alias is named differently).
        console.warn(
          "[event-analytics] attendees join failed, retrying narrow select:",
          attendeeErr,
        );
        const { data: narrow, error: narrowErr } = await supabase
          .from("tickets")
          .select(
            "id, user_id, status, purchase_amount_cents, checked_in_at, created_at, ticket_type_id, guest_email",
          )
          .eq("event_id", eventIdNum)
          .order("created_at", { ascending: true });
        if (narrowErr) {
          console.error("[event-analytics] attendees narrow select:", narrowErr);
          return errorResponse("Could not fetch attendees", 500);
        }
        return jsonResponse({
          ok: true,
          eventId: String(eventIdNum),
          title: event.title || "",
          attendees: (narrow || []).map((t: any) => ({
            ticketId: String(t.id),
            buyerUsername: null,
            buyerEmail: t.guest_email ?? null,
            buyerName: null,
            tierName: null,
            tierPriceCents: null,
            status: t.status,
            purchaseAmountCents: Number(t.purchase_amount_cents || 0),
            checkedInAt: t.checked_in_at ?? null,
            createdAt: t.created_at,
          })),
        });
      }

      const attendees = (attendeeRows || []).map((t: any) => {
        const buyer = Array.isArray(t.buyer) ? t.buyer[0] : t.buyer;
        const tier = Array.isArray(t.ticket_type)
          ? t.ticket_type[0]
          : t.ticket_type;
        const fullName =
          buyer?.first_name && buyer?.last_name
            ? `${buyer.first_name} ${buyer.last_name}`
            : (buyer?.first_name ?? buyer?.last_name ?? null);
        return {
          ticketId: String(t.id),
          buyerUsername: buyer?.username ?? null,
          buyerEmail: buyer?.email ?? t.guest_email ?? null,
          buyerName: fullName,
          tierName: tier?.name ?? null,
          tierPriceCents: tier?.price_cents == null ? null : Number(tier.price_cents),
          status: t.status,
          purchaseAmountCents: Number(t.purchase_amount_cents || 0),
          checkedInAt: t.checked_in_at ?? null,
          createdAt: t.created_at,
        };
      });

      return jsonResponse({
        ok: true,
        eventId: String(eventIdNum),
        title: event.title || "",
        attendees,
      });
    }

    // ── default action: summary ─────────────────────────────
    // The four reads below are independent — run them in parallel so
    // the dashboard paints at max(latency) instead of sum(latency).
    const [
      financialsRes,
      ticketsRes,
      tierRes,
      promoRes,
    ] = await Promise.all([
      supabase
        .from("event_financials")
        .select(
          "gross_cents, refunds_cents, dvnt_fee_cents, stripe_fee_cents, net_cents, calculated_at",
        )
        .eq("event_id", eventIdNum)
        .maybeSingle(),
      supabase
        .from("tickets")
        .select("id, ticket_type_id, status, checked_in_at, purchase_amount_cents")
        .eq("event_id", eventIdNum),
      supabase
        .from("ticket_types")
        .select(
          "id, name, price_cents, quantity_total, quantity_sold, is_active",
        )
        .eq("event_id", eventIdNum)
        .order("price_cents", { ascending: true }),
      supabase
        .from("promo_codes")
        .select("id, code, discount_type, discount_value, uses_count, max_uses")
        .eq("event_id", eventIdNum)
        .order("uses_count", { ascending: false })
        .limit(5),
    ]);

    const financials = financialsRes.data;
    const { data: ticketRows, error: ticketsErr } = ticketsRes;
    const { data: tierRows } = tierRes;
    const { data: promoRows } = promoRes;

    const revenue = {
      grossCents: Number(financials?.gross_cents ?? 0),
      refundsCents: Number(financials?.refunds_cents ?? 0),
      dvntFeeCents: Number(financials?.dvnt_fee_cents ?? 0),
      stripeFeeCents: Number(financials?.stripe_fee_cents ?? 0),
      netCents: Number(financials?.net_cents ?? 0),
      calculatedAt: financials?.calculated_at ?? null,
    };

    if (ticketsErr) {
      console.error("[event-analytics] tickets error:", ticketsErr);
      return errorResponse("Ticket stats failed", 500);
    }

    const tickets = ticketRows || [];
    // A ticket counts as checked-in if EITHER checked_in_at is set OR the
    // status is "scanned" — some code paths set only one.
    let checkedIn = 0;
    let active = 0;
    let refunded = 0;
    let voidCount = 0;
    let transferPending = 0;
    for (const t of tickets) {
      const isCheckedIn = t.checked_in_at != null || t.status === "scanned";
      if (isCheckedIn) checkedIn++;
      else if (t.status === "active") active++;
      else if (t.status === "refunded") refunded++;
      else if (t.status === "void") voidCount++;
      else if (t.status === "transfer_pending") transferPending++;
    }
    const ticketStats = {
      total: tickets.length,
      active,
      checkedIn,
      refunded,
      void: voidCount,
      transferPending,
    };

    // ── 3. Per-tier breakdown ──
    const tierRevenueCentsById = new Map<string, number>();
    for (const t of tickets) {
      const key = String(t.ticket_type_id);
      const prev = tierRevenueCentsById.get(key) ?? 0;
      tierRevenueCentsById.set(
        key,
        prev + Number(t.purchase_amount_cents || 0),
      );
    }

    const tiers = (tierRows || []).map((t: any) => {
      const quantityTotal = Number(t.quantity_total || 0);
      const quantitySold = Number(t.quantity_sold || 0);
      const remaining = Math.max(0, quantityTotal - quantitySold);
      const percentSold =
        quantityTotal > 0
          ? Math.min(100, Math.round((quantitySold / quantityTotal) * 100))
          : 0;
      return {
        id: String(t.id),
        name: t.name,
        priceCents: Number(t.price_cents || 0),
        quantityTotal,
        quantitySold,
        remaining,
        percentSold,
        revenueCents: tierRevenueCentsById.get(String(t.id)) ?? 0,
        isActive: t.is_active !== false,
      };
    });

    // ── 4. Promo codes (top 5 by uses) ──
    const promoCodes = (promoRows || []).map((p: any) => ({
      id: String(p.id),
      code: p.code,
      discountType: p.discount_type,
      discountValue: Number(p.discount_value || 0),
      usesCount: Number(p.uses_count || 0),
      maxUses: p.max_uses == null ? null : Number(p.max_uses),
    }));

    return jsonResponse({
      ok: true,
      eventId: String(eventIdNum),
      title: event.title || "",
      revenue,
      ticketStats,
      tiers,
      promoCodes,
    });
  } catch (err: any) {
    console.error("[event-analytics] Unexpected error:", err);
    return errorResponse("Internal error", 500);
  }
});
