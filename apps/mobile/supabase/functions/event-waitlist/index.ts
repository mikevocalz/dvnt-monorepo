/**
 * Event Waitlist Edge Function
 *
 * POST /event-waitlist
 * Body:
 *   { event_id, ticket_type_id?, action: "join" }   → add caller to waitlist
 *   { event_id, ticket_type_id?, action: "leave" }  → remove caller from waitlist
 *   { event_id, ticket_type_id?, action: "status" } → return { joined: boolean }
 *   { event_id,                  action: "list"   } → host-only: full waitlist
 *
 * `ticket_type_id` is optional — when omitted, the user is on the waitlist
 * for ANY tier of the event. The unique index keys on
 * COALESCE(ticket_type_id, '') so a user can be on the all-tiers waitlist
 * AND a tier-specific waitlist simultaneously.
 *
 * Idempotent: re-joining returns the existing row, re-leaving is a noop.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

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

    let body: {
      event_id?: string | number;
      ticket_type_id?: string | null;
      action?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const eventIdNum = Number(body.event_id);
    if (!Number.isFinite(eventIdNum) || eventIdNum <= 0) {
      return errorResponse("event_id required", 400);
    }
    const action = (body.action || "status").toString();
    const tierId = body.ticket_type_id ?? null;

    // Applies the NULL-vs-UUID ticket_type_id predicate to a supabase
    // query builder. `tierId = null` means "any tier" on the waitlist;
    // PostgREST needs .is() for null and .eq() for a concrete uuid.
    const withTier = (q: any) =>
      tierId === null
        ? q.is("ticket_type_id", null)
        : q.eq("ticket_type_id", tierId);

    // Confirm event exists (also surfaces 404 cleanly for bad IDs)
    const { data: event } = await supabase
      .from("events")
      .select("id, host_id, title")
      .eq("id", eventIdNum)
      .maybeSingle();
    if (!event) return errorResponse("Event not found", 404);

    if (action === "join") {
      // Anti-spam: a real user joining + leaving should be measured in
      // seconds, not hundreds-of-requests per minute.
      const rl = checkRateLimit(authId, "event-waitlist-join", {
        maxRequests: 10,
        windowMs: 60_000,
      });
      if (!rl.allowed) {
        return errorResponse("Too many waitlist requests", 429);
      }
      // Idempotent: try to insert; if the unique index trips, return the existing row.
      const insertPayload: Record<string, unknown> = {
        event_id: eventIdNum,
        ticket_type_id: tierId,
        user_id: authId,
      };
      const { data: inserted, error: insertErr } = await supabase
        .from("event_waitlist")
        .insert(insertPayload)
        .select("id, created_at")
        .maybeSingle();

      if (insertErr) {
        // Unique violation → already on the waitlist. Return existing row.
        if (insertErr.code === "23505" || /duplicate/i.test(insertErr.message || "")) {
          const existingQ = withTier(
            supabase
              .from("event_waitlist")
              .select("id, created_at")
              .eq("event_id", eventIdNum)
              .eq("user_id", authId),
          );
          const { data: existing } = await existingQ.maybeSingle();
          return jsonResponse({
            ok: true,
            joined: true,
            id: existing?.id ?? null,
            createdAt: existing?.created_at ?? null,
            alreadyJoined: true,
          });
        }
        console.error("[event-waitlist] join error:", insertErr);
        return errorResponse("Could not join waitlist", 500);
      }
      return jsonResponse({
        ok: true,
        joined: true,
        id: inserted?.id ?? null,
        createdAt: inserted?.created_at ?? null,
      });
    }

    if (action === "leave") {
      const q = withTier(
        supabase
          .from("event_waitlist")
          .delete()
          .eq("event_id", eventIdNum)
          .eq("user_id", authId),
      );
      const { error: deleteErr } = await q;
      if (deleteErr) {
        console.error("[event-waitlist] leave error:", deleteErr);
        return errorResponse("Could not leave waitlist", 500);
      }
      return jsonResponse({ ok: true, joined: false });
    }

    if (action === "status") {
      const q = withTier(
        supabase
          .from("event_waitlist")
          .select("id, created_at")
          .eq("event_id", eventIdNum)
          .eq("user_id", authId),
      );
      const { data, error } = await q.maybeSingle();
      if (error) {
        console.error("[event-waitlist] status error:", error);
        return errorResponse("Status check failed", 500);
      }
      return jsonResponse({
        ok: true,
        joined: !!data,
        id: data?.id ?? null,
        createdAt: data?.created_at ?? null,
      });
    }

    if (action === "list") {
      if (String(event.host_id) !== String(authId)) {
        return errorResponse("Not your event", 403);
      }
      const { data: rows, error: listErr } = await supabase
        .from("event_waitlist")
        .select(
          `id, ticket_type_id, user_id, guest_email, created_at, notified_at,
           buyer:users!event_waitlist_user_id_fkey(username, email)`,
        )
        .eq("event_id", eventIdNum)
        .order("created_at", { ascending: true });

      // Fall back to a narrower select if the FK alias is missing
      if (listErr) {
        const { data: narrow } = await supabase
          .from("event_waitlist")
          .select("id, ticket_type_id, user_id, guest_email, created_at, notified_at")
          .eq("event_id", eventIdNum)
          .order("created_at", { ascending: true });
        return jsonResponse({
          ok: true,
          eventId: String(eventIdNum),
          waitlist: (narrow || []).map((r: any) => ({
            id: String(r.id),
            ticketTypeId: r.ticket_type_id ? String(r.ticket_type_id) : null,
            userId: r.user_id ?? null,
            guestEmail: r.guest_email ?? null,
            buyerUsername: null,
            buyerEmail: r.guest_email ?? null,
            createdAt: r.created_at,
            notifiedAt: r.notified_at,
          })),
        });
      }

      return jsonResponse({
        ok: true,
        eventId: String(eventIdNum),
        waitlist: (rows || []).map((r: any) => {
          const buyer = Array.isArray(r.buyer) ? r.buyer[0] : r.buyer;
          return {
            id: String(r.id),
            ticketTypeId: r.ticket_type_id ? String(r.ticket_type_id) : null,
            userId: r.user_id ?? null,
            guestEmail: r.guest_email ?? null,
            buyerUsername: buyer?.username ?? null,
            buyerEmail: buyer?.email ?? r.guest_email ?? null,
            createdAt: r.created_at,
            notifiedAt: r.notified_at,
          };
        }),
      });
    }

    return errorResponse("Unknown action", 400);
  } catch (err: any) {
    console.error("[event-waitlist] unexpected:", err);
    return errorResponse("Internal error", 500);
  }
});
