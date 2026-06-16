/**
 * export-event-attendees Edge Function
 *
 * POST /export-event-attendees
 * Body: { event_id: number, format?: "csv" }
 *
 * Returns the full attendee roster as a CSV download for the host or
 * an admin/editor co-organizer. Scanners are blocked — exports leak
 * PII (email, purchase amount) and scanners should not have access.
 *
 * Response:
 *   200 text/csv  → raw CSV body (no JSON envelope; download-ready)
 *   401/403/404 → JSON error
 *
 * Columns: ticket_id, status, tier, attendee_name, attendee_email,
 * attendee_username, purchase_amount, scanned_at, transferred_to,
 * created_at. Cents → dollars in the export for spreadsheet friendliness.
 *
 * No streaming yet — pulls all rows in one go. CSV stays small (<5MB)
 * even for 5,000-row events. Add cursor pagination if events scale past
 * 25k attendees per export.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function jsonError(message: string, status: number, req: Request) {
  return new Response(
    JSON.stringify({ ok: false, error: { message } }),
    {
      status,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    },
  );
}

/**
 * RFC 4180 CSV cell. Quotes a value if it contains comma/quote/newline.
 * Doubles internal quotes. Null/undefined → empty cell.
 */
function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

function formatDollarsFromCents(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (Number(cents) / 100).toFixed(2);
}

function isoOrEmpty(v: string | null | undefined): string {
  if (!v) return "";
  try {
    return new Date(v).toISOString();
  } catch {
    return "";
  }
}

function safeFilename(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^A-Za-z0-9._-]/g, "")
      .slice(0, 80) || "event"
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST")
    return jsonError("Method not allowed", 405, req);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return jsonError("Unauthorized", 401, req);

    let body: { event_id?: string | number; format?: string } = {};
    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON body", 400, req);
    }

    const eventId = Number(body.event_id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return jsonError("event_id required", 400, req);
    }

    // Permission gate — owner or accepted admin/editor only.
    // Scanner role is explicitly denied for exports (PII leak risk).
    const { data: event } = await supabase
      .from("events")
      .select("id, title, host_id, start_date")
      .eq("id", eventId)
      .maybeSingle();
    if (!event) return jsonError("Event not found", 404, req);

    const isOwner = String(event.host_id) === String(authId);
    if (!isOwner) {
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role, accepted")
        .eq("event_id", eventId)
        .eq("user_id", authId)
        .eq("accepted", true)
        .in("role", ["admin", "editor"])
        .maybeSingle();
      if (!coOrg) {
        return jsonError(
          "Only event owners and admin/editor co-organizers can export attendees",
          403,
          req,
        );
      }
    }

    // Pull tickets + tier name in one join. Cap at 10k rows defensively;
    // anything larger should use a paginated/streaming export.
    const { data: tickets, error: ticketsErr } = await supabase
      .from("tickets")
      .select(
        "id, status, user_id, transfer_to_user_id, purchase_amount_cents, checked_in_at, transferred_at, created_at, ticket_types(name)",
      )
      .eq("event_id", eventId)
      .order("created_at", { ascending: true })
      .limit(10_000);
    if (ticketsErr) {
      console.error("[export-event-attendees] tickets query:", ticketsErr);
      return jsonError("Could not fetch tickets", 500, req);
    }

    // Resolve user info in one bulk lookup (no N+1).
    const userIds = new Set<string>();
    for (const t of tickets || []) {
      if (t.user_id) userIds.add(String(t.user_id));
      if (t.transfer_to_user_id)
        userIds.add(String(t.transfer_to_user_id));
    }

    const userMap = new Map<
      string,
      { username: string | null; name: string | null; email: string | null }
    >();
    if (userIds.size > 0) {
      const ids = Array.from(userIds);
      // app `users` table (profile data: username, name)
      const { data: appUsers } = await supabase
        .from("users")
        .select("auth_id, username, name")
        .in("auth_id", ids);
      // Better Auth `user` table (email is source of truth)
      const { data: baUsers } = await supabase
        .from("user")
        .select("id, email, name")
        .in("id", ids);

      for (const u of baUsers || []) {
        userMap.set(String(u.id), {
          username: null,
          name: u.name || null,
          email: u.email || null,
        });
      }
      for (const u of appUsers || []) {
        const existing = userMap.get(String(u.auth_id)) || {
          username: null,
          name: null,
          email: null,
        };
        userMap.set(String(u.auth_id), {
          username: u.username || existing.username,
          name: u.name || existing.name,
          email: existing.email,
        });
      }
    }

    // Build CSV
    const header = [
      "ticket_id",
      "status",
      "tier",
      "attendee_name",
      "attendee_email",
      "attendee_username",
      "purchase_amount_usd",
      "checked_in_at",
      "transferred_to_username",
      "transferred_at",
      "created_at",
    ];
    const lines: string[] = [csvRow(header)];

    for (const t of tickets || []) {
      const owner = t.user_id ? userMap.get(String(t.user_id)) : undefined;
      const transferTo = t.transfer_to_user_id
        ? userMap.get(String(t.transfer_to_user_id))
        : undefined;
      // ticket_types is returned as an array by PostgREST when the FK
      // is many-to-one and the table is referenced without !inner —
      // handle both shapes defensively.
      const ttRaw: any = (t as any).ticket_types;
      const tierName = Array.isArray(ttRaw)
        ? ttRaw[0]?.name || "General"
        : ttRaw?.name || "General";

      lines.push(
        csvRow([
          t.id,
          t.status,
          tierName,
          owner?.name || "",
          owner?.email || "",
          owner?.username || "",
          formatDollarsFromCents(t.purchase_amount_cents),
          isoOrEmpty(t.checked_in_at),
          transferTo?.username || "",
          isoOrEmpty(t.transferred_at),
          isoOrEmpty(t.created_at),
        ]),
      );
    }

    const csv = lines.join("\r\n") + "\r\n";
    const datePart = new Date().toISOString().slice(0, 10);
    const filename = `${safeFilename(event.title || `event-${eventId}`)}-attendees-${datePart}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        ...corsHeaders(req),
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[export-event-attendees] unexpected:", err);
    return jsonError(err?.message || "Internal error", 500, req);
  }
});
