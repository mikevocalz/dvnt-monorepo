/**
 * get-guest-ticket Edge Function
 *
 * POST /get-guest-ticket
 * Body: { token: string }
 *
 * Unauthenticated — the request is gated by possession of a
 * `guest_lookup_token`, which is a crypto.randomUUID() issued per
 * ticket when a guest completes checkout. The token is only ever
 * delivered to the buyer's email, so "anyone with the token is the
 * ticket holder" is the authorisation model.
 *
 * Returns the minimal ticket shape a guest needs to show at the
 * door: title, date, location, tier, qr_token. No PII beyond what
 * the guest already gave us at checkout.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
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

    let body: { token?: string } = {};
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const token =
      typeof body.token === "string" ? body.token.trim() : "";
    // Reject anything that doesn't look like a UUID up front so a
    // brute-force scraper gets the cheap rejection path.
    if (!token || !/^[a-f0-9-]{16,64}$/i.test(token)) {
      return errorResponse("Invalid token", 400);
    }

    const { data: ticket, error } = await supabase
      .from("tickets")
      .select(
        `
        id,
        event_id,
        status,
        qr_token,
        qr_payload,
        checked_in_at,
        purchase_amount_cents,
        guest_email,
        guest_name,
        ticket_type:ticket_types(name),
        event:events(title, start_date, end_date, location_name, location_address, cover_image_url)
      `,
      )
      .eq("guest_lookup_token", token)
      .maybeSingle();

    if (error) {
      console.error("[get-guest-ticket] lookup:", error);
      return errorResponse("Could not fetch ticket", 500);
    }
    if (!ticket) return errorResponse("Ticket not found", 404);

    const tierRow = Array.isArray((ticket as any).ticket_type)
      ? (ticket as any).ticket_type[0]
      : (ticket as any).ticket_type;
    const eventRow = Array.isArray((ticket as any).event)
      ? (ticket as any).event[0]
      : (ticket as any).event;

    return jsonResponse({
      ok: true,
      ticket: {
        id: String(ticket.id),
        status: ticket.status,
        qrToken: ticket.qr_token,
        qrPayload: ticket.qr_payload,
        checkedInAt: ticket.checked_in_at,
        purchaseAmountCents: Number(ticket.purchase_amount_cents || 0),
        tierName: tierRow?.name ?? null,
        guestEmail: ticket.guest_email ?? null,
        guestName: ticket.guest_name ?? null,
        event: {
          id: String(ticket.event_id),
          title: eventRow?.title ?? "",
          startDate: eventRow?.start_date ?? null,
          endDate: eventRow?.end_date ?? null,
          location:
            eventRow?.location_name ??
            eventRow?.location_address ??
            null,
          coverImageUrl: eventRow?.cover_image_url ?? null,
        },
      },
    });
  } catch (err) {
    console.error("[get-guest-ticket] unexpected:", err);
    return errorResponse("Internal error", 500);
  }
});
