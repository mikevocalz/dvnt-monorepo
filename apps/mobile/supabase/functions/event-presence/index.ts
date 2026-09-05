/**
 * event-presence Edge Function — Host & Guest WS-5.
 *
 * POST { action: "report", event_id, ticket_id, state }
 *   → upsert the caller's discrete arrival state for one event.
 * POST { action: "revoke", event_id, ticket_id }
 *   → delete it immediately (consent revocation).
 *
 * PRIVACY CONTRACT, enforced here and in the schema:
 *   - The request carries a STATE WORD. There is no coordinate field to send,
 *     and the table has no column to store one in.
 *   - The caller may only write their OWN ticket. Ownership is checked against
 *     the verified session, never taken from the body.
 *   - Rows expire at event end + 6h and are swept by expire_event_presence().
 *
 * Presence never admits anyone. `ticket-scan` owns admission; a state of
 * `arrived` is staging information for the host and nothing more.
 */

import { presenceExpiry } from "../_shared/presence-expiry.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const STATES = new Set(["approaching", "arrived", "departed"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const authId = await verifySession(supabase, req);
    if (!authId) return errorResponse("Unauthorized", 401);

    let body: {
      action?: string;
      event_id?: string | number;
      ticket_id?: string;
      state?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return errorResponse("Bad request", 400);
    }

    const eventId = Number(body.event_id);
    const ticketId = String(body.ticket_id || "");
    if (!Number.isFinite(eventId) || !ticketId) {
      return errorResponse("event_id and ticket_id are required", 400);
    }

    // Ownership from the SESSION, never from the body: a member may only ever
    // write presence for a ticket they hold, at the event that ticket is for.
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, event_id, user_id")
      .eq("id", ticketId)
      .maybeSingle();
    if (
      !ticket ||
      ticket.user_id !== authId ||
      Number(ticket.event_id) !== eventId
    ) {
      return errorResponse("Forbidden", 403);
    }

    if (body.action === "revoke") {
      // Immediate and complete — revocation is not a soft delete.
      const { error } = await supabase
        .from("event_presence")
        .delete()
        .eq("event_id", eventId)
        .eq("ticket_id", ticketId);
      if (error) return errorResponse("Could not revoke", 500);
      return jsonResponse({ ok: true, revoked: true });
    }

    if (body.action !== "report") return errorResponse("Unknown action", 400);

    const state = String(body.state || "");
    if (!STATES.has(state)) return errorResponse("Invalid state", 400);

    // TTL: the operational window and a little slack, then it is gone. Falls
    // back to 6h from now when the event has no end time recorded.
    const { data: ev } = await supabase
      .from("events")
      .select("end_date")
      .eq("id", eventId)
      .maybeSingle();
    const expiresAt = presenceExpiry(ev?.end_date);

    const { error } = await supabase.from("event_presence").upsert(
      {
        event_id: eventId,
        ticket_id: ticketId,
        user_id: authId,
        state,
        updated_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: "event_id,ticket_id" },
    );
    if (error) {
      console.error("[event-presence] upsert error:", error);
      return errorResponse("Could not record presence", 500);
    }

    return jsonResponse({ ok: true, state });
  } catch (err) {
    console.error("[event-presence] unexpected:", err);
    return errorResponse("Internal error", 500);
  }
});
