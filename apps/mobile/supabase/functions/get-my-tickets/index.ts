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
        "*, ticket_types(name), events(title, cover_image_url, start_date, end_date, location)",
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

    const tickets = (data || []).map((t: any) => ({
      ...t,
      ticket_type_name: t.ticket_types?.name || "General",
      event_title: t.events?.title || "",
      event_image: t.events?.cover_image_url || "",
      event_date: t.events?.start_date || "",
      event_location: t.events?.location || "",
    }));

    return jsonResponse({ ok: true, tickets });
  } catch (err) {
    console.error("[get-my-tickets] unexpected:", err);
    return errorResponse("Internal error", 500);
  }
});
