/**
 * unlock-ticket-tier Edge Function
 *
 * POST /unlock-ticket-tier
 * Body: { event_id: number, code: string }
 * Returns: { valid: true, tier_ids: string[] }
 *       or { valid: false, error }
 *
 * Client seam: packages/app/lib/api/ticket-types.ts → ticketTypesApi.unlockTier()
 * (invoked with requireAuth: false).
 *
 * Anonymous-friendly on purpose: guests unlock locked tiers too (mirrors the
 * guest-checkout rail), so NO session is required. The supabase-js client
 * still sends the anon key as its JWT, which satisfies the platform's
 * verify_jwt gate — no config.toml pin needed for the app's call path.
 *
 * Security posture:
 *  - The submitted code is compared SERVER-SIDE (service role) against
 *    ticket_types.unlock_code — case-insensitive, trimmed. The code never
 *    reaches PostgREST under the client's own role.
 *  - The response NEVER echoes the code back and NEVER enumerates which
 *    tiers are locked on failure — a wrong guess learns nothing about the
 *    event's tier structure (same generic error whether the event has zero
 *    locked tiers or ten).
 *  - Only `tier_visibility = 'locked'` tiers are matched. Hidden tiers stay
 *    hidden (they are comps/holds and are unpurchasable server-side —
 *    see migration 20260806201000).
 *
 * Rate limiting: per-IP + per-IP-per-event sliding windows via the shared
 * in-memory limiter (_shared/rate-limit.ts). Per-isolate only — the Map
 * resets on cold start and is not shared across isolates, so this is
 * best-effort burst protection, not a hard global cap. ponytail: that
 * ceiling is accepted — codes are short human-shared secrets scoped to one
 * event; a counter table for this endpoint is overkill. Revisit only if
 * abuse shows up in logs (then move to the DB-backed check_rate_limit RPCs).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Generic failure body — identical for "no such event", "no locked tiers",
 * and "wrong code" so the endpoint can't be used as an oracle. */
const INVALID = { valid: false, error: "Invalid code." };

const MAX_CODE_LENGTH = 64;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    // ── Rate limit: per-IP and per-IP-per-event ─────────────────────────
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    const perIp = checkRateLimit(ip, "unlock-ticket-tier", {
      maxRequests: 30,
      windowMs: 60_000,
    });
    if (!perIp.allowed) {
      return jsonResponse(
        { valid: false, error: "Too many attempts. Try again in a minute." },
        429,
      );
    }

    // ── Parse + validate input ──────────────────────────────────────────
    let body: { event_id?: unknown; code?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ valid: false, error: "Invalid request." }, 400);
    }

    const eventId = Number(body.event_id);
    const rawCode = typeof body.code === "string" ? body.code : "";
    const code = rawCode.trim().toLowerCase();

    if (!Number.isFinite(eventId) || eventId <= 0 || !code) {
      return jsonResponse(
        { valid: false, error: "Missing event_id or code." },
        400,
      );
    }
    if (code.length > MAX_CODE_LENGTH) {
      return jsonResponse(INVALID);
    }

    const perEvent = checkRateLimit(
      `${ip}:${eventId}`,
      "unlock-ticket-tier-event",
      { maxRequests: 10, windowMs: 60_000 },
    );
    if (!perEvent.allowed) {
      return jsonResponse(
        { valid: false, error: "Too many attempts. Try again in a minute." },
        429,
      );
    }

    // ── Server-side compare (service role; RLS bypassed intentionally) ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const { data: tiers, error: tierError } = await supabase
      .from("ticket_types")
      .select("id, unlock_code")
      .eq("event_id", eventId)
      .eq("tier_visibility", "locked")
      .not("unlock_code", "is", null);

    if (tierError) {
      console.error("[unlock-ticket-tier] tier lookup failed:", tierError);
      return jsonResponse({ valid: false, error: "Internal error." }, 500);
    }

    const tierIds = (tiers || [])
      .filter(
        (t: { id: string; unlock_code: string | null }) =>
          (t.unlock_code || "").trim().toLowerCase() === code,
      )
      .map((t: { id: string }) => String(t.id));

    if (tierIds.length === 0) {
      // Same body for "event doesn't exist" / "no locked tiers" / "wrong
      // code" — never enumerate. unlock_code values never leave the server.
      return jsonResponse(INVALID);
    }

    return jsonResponse({ valid: true, tier_ids: tierIds });
  } catch (err) {
    console.error("[unlock-ticket-tier] Error:", err);
    return jsonResponse({ valid: false, error: "Internal error." }, 500);
  }
});
