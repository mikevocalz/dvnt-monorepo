/**
 * Ticket Scan / Validate Edge Function
 *
 * POST /ticket-scan  { qr_token, qr_payload?, scanned_by?, device_id?, event_id? }
 *
 * Two validation paths:
 * 1. qr_payload (HMAC-signed) — fast-path cryptographic verification
 * 2. qr_token (legacy) — DB lookup
 *
 * Records all scans in the `checkins` audit table.
 * Transactional: UPDATE tickets SET status='scanned' WHERE active
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySignedQrPayload } from "../_shared/hmac-qr.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { verifySession } from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function recordCheckin(
  supabase: any,
  ticketId: string,
  eventId: number,
  result: string,
  scannedBy?: string,
  deviceId?: string,
  offline = false,
) {
  try {
    await supabase.from("checkins").insert({
      ticket_id: ticketId,
      event_id: eventId,
      scanned_by: scannedBy || null,
      device_id: deviceId || null,
      result,
      offline,
    });
  } catch (e) {
    console.error("[ticket-scan] Checkin record error:", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { qr_token, qr_payload, scanned_by, device_id, event_id } =
      await req.json();

    if (!qr_token && !qr_payload) {
      return json({ error: "Missing qr_token or qr_payload" }, 400);
    }

    // Rate-limit per scanner identity. A single scanner can realistically process
    // at most ~1 scan per 2s in a real door line — 30/minute is a generous ceiling.
    // This prevents brute-force QR token enumeration.
    // Rate limit by raw client identifier; scannerAuthId not available
    // yet (verifySession runs below). x-forwarded-for is acceptable here.
    const rateLimitKey = device_id || req.headers.get("x-forwarded-for") || "anon";
    const rl = checkRateLimit(rateLimitKey, "ticket-scan", {
      maxRequests: 30,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return json(
        { error: `Too many scan attempts. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.` },
        429,
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    // ── AUTH GATE (V2-SEC-01 fix) ─────────────────────────────
    // Require a valid Better Auth session. Without this, anyone who
    // captured a QR token could mark tickets scanned via direct HTTP.
    const scannerAuthId = await verifySession(supabase, req);
    if (!scannerAuthId) {
      return json({ error: "Unauthorized — session required" }, 401);
    }

    let ticketId: string | null = null;
    let ticketEventId: number | null = null;

    // ── Fast path: HMAC-signed QR payload ────────────────────
    if (qr_payload) {
      const verification = await verifySignedQrPayload(qr_payload);
      if (!verification.valid) {
        return json({ valid: false, reason: "invalid_signature" });
      }
      ticketId = verification.ticketId!;
      ticketEventId = verification.eventId!;

      // Optionally verify event_id matches (prevents cross-event replay)
      if (event_id && ticketEventId !== parseInt(event_id)) {
        await recordCheckin(
          supabase,
          ticketId,
          ticketEventId,
          "wrong_event",
          scannerAuthId,
          device_id,
        );
        return json({ valid: false, reason: "wrong_event" });
      }
    }

    // ── HOST-ROLE GATE ─────────────────────────────────────────
    // Determine the event the ticket belongs to, then confirm the
    // session user is that event's host. We need this BEFORE any
    // status mutation. For HMAC path we already have ticketEventId.
    // For legacy qr_token path we need to look it up first.
    let scanEventId: number | null = ticketEventId;
    if (!scanEventId && qr_token) {
      const { data: existing } = await supabase
        .from("tickets")
        .select("event_id")
        .eq("qr_token", qr_token)
        .single();
      scanEventId = existing?.event_id ?? null;
    }
    if (!scanEventId) {
      return json({ valid: false, reason: "ticket_not_found" });
    }
    const { data: scanEvent } = await supabase
      .from("events")
      .select("host_id")
      .eq("id", scanEventId)
      .single();
    if (!scanEvent) {
      return json({ valid: false, reason: "event_not_found" }, 404);
    }
    const isHost = String(scanEvent.host_id) === String(scannerAuthId);

    // V2-SEC-02b: also honor event_co_organizers role for non-host staff.
    // The role ladder is owner → admin → editor → scanner; anyone above
    // (or equal to) 'scanner' AND accepted can check in tickets. This
    // unblocks door staff that aren't the actual event owner.
    let isAuthorizedScanner = isHost;
    if (!isAuthorizedScanner) {
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role, accepted")
        .eq("event_id", scanEventId)
        .eq("user_id", scannerAuthId)
        .eq("accepted", true)
        .in("role", ["scanner", "editor", "admin"])
        .maybeSingle();
      isAuthorizedScanner = !!coOrg;
    }

    if (!isAuthorizedScanner) {
      return json(
        { error: "Forbidden — not the event host or an authorized scanner" },
        403,
      );
    }

    // ── Atomic check-in by ticket ID (from HMAC) or qr_token (legacy) ──
    // checked_in_by is forced to the verified session user; we don't
    // trust the client-supplied scanned_by value for the audit trail.
    let updateQuery = supabase
      .from("tickets")
      .update({
        status: "scanned",
        checked_in_at: new Date().toISOString(),
        checked_in_by: scannerAuthId,
      })
      .eq("status", "active");

    if (ticketId) {
      updateQuery = updateQuery.eq("id", ticketId);
    } else {
      updateQuery = updateQuery.eq("qr_token", qr_token);
    }

    const { data: ticket, error } = await updateQuery
      .select(
        "id, event_id, ticket_type_id, user_id, status, qr_token, checked_in_at, purchase_amount_cents",
      )
      .single();

    if (error || !ticket) {
      // Check if ticket exists but isn't active
      let existingQuery = supabase
        .from("tickets")
        .select("id, event_id, status, checked_in_at");

      if (ticketId) {
        existingQuery = existingQuery.eq("id", ticketId);
      } else {
        existingQuery = existingQuery.eq("qr_token", qr_token);
      }

      const { data: existing } = await existingQuery.single();

      if (existing) {
        const reason =
          existing.status === "scanned"
            ? "already_scanned"
            : existing.status === "refunded"
              ? "refunded"
              : existing.status === "transfer_pending"
                ? "transfer_pending"
                : existing.status === "void"
                  ? "voided"
                  : "invalid_status";

        await recordCheckin(
          supabase,
          existing.id,
          existing.event_id,
          reason,
          scannerAuthId,
          device_id,
        );

        return json({
          valid: false,
          reason,
          status: existing.status,
          checked_in_at: existing.checked_in_at,
        });
      }

      return json({ valid: false, reason: "not_found" });
    }

    // ── Record successful checkin ────────────────────────────
    await recordCheckin(
      supabase,
      ticket.id,
      ticket.event_id,
      "valid",
      scannerAuthId,
      device_id,
    );

    // Fetch user info for display
    const { data: user } = await supabase
      .from("users")
      .select("username, first_name, last_name")
      .eq("auth_id", ticket.user_id)
      .single();

    // Fetch ticket type name
    const { data: ticketType } = await supabase
      .from("ticket_types")
      .select("name")
      .eq("id", ticket.ticket_type_id)
      .single();

    return json({
      valid: true,
      ticket: {
        ...ticket,
        username: user?.username || "Unknown",
        name:
          [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
          user?.username ||
          "Guest",
        tier_name: ticketType?.name || "General",
      },
    });
  } catch (err: any) {
    console.error("[ticket-scan] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
