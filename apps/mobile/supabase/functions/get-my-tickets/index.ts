/**
 * get-my-tickets Edge Function
 *
 * POST /get-my-tickets
 * Body:
 *   {}                     → all active/past tickets the caller owns
 *   { event_id: "123" }    → just the ticket(s) for one event (most recent first)
 *
 * Replaces the previous direct `supabase.from("tickets")` client reads.
 * Runs with the service role (bypasses RLS), so the tickets table's
 * anon SELECT policy can be revoked without losing this functionality.
 *
 * Authorization: Better Auth session required. Returns only rows
 * whose user_id matches the caller's authId (both the UUID form and,
 * for legacy rows written before the auth_id fix, the integer user.id).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTicketSelfServiceAction } from "../_shared/ticket-self-service.ts";
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

    let body: { event_id?: string | number } = {};
    try {
      const txt = await req.text();
      if (txt) body = JSON.parse(txt);
    } catch {
      // empty body is fine
    }

    // Find the integer user id so legacy rows with that format are
    // picked up too — mirrors the client's previous .or(…) pattern.
    const { data: userRow } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", authId)
      .maybeSingle();
    const intId = userRow?.id != null ? String(userRow.id) : null;
    const userIdCandidates = intId && intId !== authId ? [authId, intId] : [authId];

    let query = supabase
      .from("tickets")
      .select(
        // `dominant_color` rides along so the Apple Watch has an offline-safe
        // flyer colour for every card (see features/watch/watch-payload.ts).
        // It is one already-materialised column on a row we are joining anyway.
        "*, ticket_types(name), events(title, cover_image_url, dominant_color, start_date, end_date, location, event_tz, is_online, refund_policy, refund_days_before)",
      )
      .in("user_id", userIdCandidates)
      .order("created_at", { ascending: false });

    if (body.event_id != null) {
      const eventIdNum = Number(body.event_id);
      if (Number.isFinite(eventIdNum) && eventIdNum > 0) {
        query = query.eq("event_id", eventIdNum);
      }
    }

    const { data, error } = await query;
    if (error) {
      console.error("[get-my-tickets] query error:", error);
      return errorResponse("Could not fetch tickets", 500);
    }

    // Eligibility is derived from the credential and purchase, not the event's
    // generic paid/free setting. Read only context referenced by owned tickets;
    // a failed context lookup hides actions without hiding the ticket itself.
    const rows = data || [];
    const ids = (field: string) => [...new Set(rows.map((t: any) => t[field]).filter(Boolean))];
    async function context(table: string, fields: string, values: unknown[]) {
      if (!values.length) return new Map<string, any>();
      const result = await supabase.from(table).select(fields).in("id", values);
      if (result.error) {
        console.warn(`[get-my-tickets] ${table} action context unavailable`);
        return new Map<string, any>();
      }
      return new Map<string, any>((result.data || []).map((row: any) => [row.id, row]));
    }
    const [orders, carts, lines] = await Promise.all([
      context("orders", "id, event_id, user_id, status, total_cents, cart_id", ids("order_id")),
      context("carts", "id, event_id, user_id, status, stripe_pi_id", ids("cart_id")),
      context("cart_line_items", "id, cart_id, tier_id, addon_id, quantity, unit_price_cents, refunded_amount_cents", ids("cart_line_item_id")),
    ]);
    const tickets = rows.map((t: any) => ({
      ...t,
      self_service_action: getTicketSelfServiceAction({
        ticket: t,
        event: t.events,
        order: orders.get(t.order_id),
        cart: carts.get(t.cart_id),
        line: lines.get(t.cart_line_item_id),
        userId: authId,
      }),
      ticket_type_name: t.ticket_types?.name || "General",
      event_title: t.events?.title || "",
      event_image: t.events?.cover_image_url || "",
      event_dominant_color: t.events?.dominant_color ?? null,
      event_date: t.events?.start_date || "",
      // Venue zone, so the ticket shows the door time the host set ("8:00 PM PDT").
      event_tz: t.events?.event_tz ?? null,
      event_is_online: t.events?.is_online ?? false,
      event_location: t.events?.location || "",
    }));

    return jsonResponse({ ok: true, tickets });
  } catch (err) {
    console.error("[get-my-tickets] unexpected:", err);
    return errorResponse("Internal error", 500);
  }
});
