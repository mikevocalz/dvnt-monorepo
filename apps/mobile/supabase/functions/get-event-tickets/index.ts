/**
 * get-event-tickets Edge Function
 *
 * POST /get-event-tickets
 * Body shapes:
 *   { event_id }
 *     → first page of tickets (page=1, pageSize=50). Host-only view.
 *   { event_id, page, pageSize, status, search }
 *     → paginated, server-filtered. status is one of
 *       'active' | 'scanned' | 'refunded' | 'transfer_pending' | 'void' | 'all'
 *       search matches qr_token / user info (case-insensitive prefix).
 *   { event_id, offline: true }
 *     → minimal payload for offline check-in: just qr_tokens of active
 *       tickets. Same auth gate. Bypasses pagination since the roster
 *       has to be complete for offline scanner mode.
 *
 * Permission scope follows the V2-SEC ladder (owner / admin / editor /
 * scanner via event_co_organizers). Scanners get a PII-redacted payload.
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

function clampInt(
  v: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

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
      offline?: boolean;
      page?: number;
      pageSize?: number;
      status?: string;
      search?: string;
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

    // Permission scope: owner is always allowed. Co-organizers with
    // accepted role in (admin, editor, scanner) are also allowed BUT
    // get a PII-redacted payload when their role is 'scanner'.
    const { data: event } = await supabase
      .from("events")
      .select("id, host_id")
      .eq("id", eventIdNum)
      .maybeSingle();
    if (!event) return errorResponse("Event not found", 404);

    const isOwner = String(event.host_id) === String(authId);
    let effectiveRole: "owner" | "admin" | "editor" | "scanner" | null =
      isOwner ? "owner" : null;
    if (!effectiveRole) {
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role, accepted")
        .eq("event_id", eventIdNum)
        .eq("user_id", authId)
        .eq("accepted", true)
        .in("role", ["scanner", "editor", "admin"])
        .maybeSingle();
      if (coOrg?.role) {
        effectiveRole = coOrg.role as typeof effectiveRole;
      }
    }
    if (!effectiveRole) {
      return errorResponse("Not your event", 403);
    }

    // Offline tokens variant — minimal payload, active tickets only.
    // Scanners need this even in offline mode, so it's allowed at any
    // role tier. Returns just qr_tokens (no PII).
    if (body.offline === true) {
      const { data, error } = await supabase
        .from("tickets")
        .select("qr_token")
        .eq("event_id", eventIdNum)
        .eq("status", "active")
        .not("qr_token", "is", null);
      if (error) {
        console.error("[get-event-tickets] offline query error:", error);
        return errorResponse("Could not fetch tokens", 500);
      }
      const qrTokens = (data || [])
        .map((t: any) => t.qr_token)
        .filter(Boolean);
      return jsonResponse({ ok: true, qr_tokens: qrTokens });
    }

    // Pagination + status filter + search — server-side per Phase 5
    // (roster needs to scale to 5,000+ attendees without client-side
    // filtering of the full list).
    const pageSize = clampInt(body.pageSize, 50, 1, 200);
    const page = clampInt(body.page, 1, 1, 1_000_000);
    const offset = (page - 1) * pageSize;
    const status = typeof body.status === "string" ? body.status : "all";
    const search =
      typeof body.search === "string" ? body.search.trim() : "";

    let query = supabase
      .from("tickets")
      .select("*, ticket_types(name)", { count: "exact" })
      .eq("event_id", eventIdNum);

    if (
      status &&
      status !== "all" &&
      ["active", "scanned", "refunded", "transfer_pending", "void"].includes(
        status,
      )
    ) {
      query = query.eq("status", status);
    }

    if (search) {
      // qr_token prefix match (case-insensitive) is the cheapest +
      // most useful search target. We don't join users here to keep
      // this query fast; user-by-name search would benefit from a
      // dedicated FTS index and is left for a follow-up.
      query = query.ilike("qr_token", `${escapeLike(search)}%`);
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error("[get-event-tickets] query error:", error);
      return errorResponse("Could not fetch tickets", 500);
    }

    const isScanner = effectiveRole === "scanner";
    const tickets = (data || []).map((t: any) => {
      const base = {
        id: t.id,
        event_id: t.event_id,
        ticket_type_id: t.ticket_type_id,
        status: t.status,
        qr_token: t.qr_token,
        ticket_type_name: t.ticket_types?.name || "General",
        checked_in_at: t.checked_in_at,
        checked_in_by: t.checked_in_by,
      };
      if (isScanner) {
        // Scanner role: name + tier + add-on info only. No emails, no
        // purchase amounts, no Stripe references. PII visibility is
        // gated server-side per Phase 5.8 of the organizer prompt.
        return base;
      }
      // Owner/admin/editor get the full row
      return {
        ...t,
        ticket_type_name: t.ticket_types?.name || "General",
      };
    });

    return jsonResponse({
      ok: true,
      tickets,
      page,
      pageSize,
      total: count ?? null,
      hasMore: count != null ? offset + pageSize < count : tickets.length === pageSize,
      role: effectiveRole,
    });
  } catch (err) {
    console.error("[get-event-tickets] unexpected:", err);
    return errorResponse("Internal error", 500);
  }
});
