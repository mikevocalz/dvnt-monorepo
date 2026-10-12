/**
 * Validate Promo Code Edge Function
 *
 * POST /validate-promo-code
 * Body: { event_id, code, ticket_type_id? }
 *
 * Returns: { valid, discount_type, discount_value, promo_code_id }
 *         or { valid: false, error }
 *
 * Validates a promo code against:
 *   - Event match
 *   - Ticket type match (if scoped)
 *   - Max uses
 *   - Validity window
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { escapeLikePattern, validateAndApplyPromoterCode } from "../_shared/apply-promoter-code.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-auth-token, apikey, x-client-info, sentry-trace, baggage",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    // ── Session auth ──────────────────────────────────────
    const userId = await verifySession(supabase, req);
    if (!userId) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => null);
    const { event_id, code, ticket_type_id, accept_promoter } = body ?? {};
    const eventId = Number(event_id);
    if (!Number.isSafeInteger(eventId) || eventId <= 0 || typeof code !== "string" ||
        !code.trim() || code.length > 64 || /[\x00-\x1f\x7f]/.test(code)) {
      return json({ valid: false, error: "Enter a valid event and code." }, 400);
    }

    const normalizedCode = code.trim().toUpperCase();

    // ── Look up promo code ────────────────────────────────
    // Match by event_id + UPPER(code), optionally scoped to ticket_type
    let query = supabase
      .from("promo_codes")
      .select("*")
      .eq("event_id", eventId)
      .is("deleted_at", null)
      .ilike("code", escapeLikePattern(normalizedCode));

    const { data: promos, error: promoError } = await query;

    if (promoError) return json({ valid: false, error: "Could not check the code. Please try again." }, 503);
    if (!promos?.length) {
      // Opt-in discriminated response: old promo-only clients cannot treat a
      // promoter as a normal promo. Exact promo matches keep precedence even
      // when expired, capped or scoped to another ticket type.
      if (accept_promoter !== true) return json({ valid: false, error: "Invalid promo code" });
      const { result, error } = await validateAndApplyPromoterCode(supabase, eventId, normalizedCode, 0);
      if (!result || error) return json({ valid: false,
        error: error === "Promoter code lookup failed" ? "Could not check the code. Please try again."
          : "That promo or promoter code is invalid or no longer active." });
      return json({ valid: true, code_kind: "promoter", code: result.code,
        customer_discount_bps: result.customer_discount_bps });
    }

    // Find best match: prefer ticket_type-scoped, then event-wide
    let promo = promos.find(
      (p: any) => p.ticket_type_id === ticket_type_id,
    );
    if (!promo) {
      promo = promos.find((p: any) => !p.ticket_type_id);
    }
    if (!promo) {
      return json({
        valid: false,
        error: "Promo code not valid for this ticket type",
      });
    }

    // ── Validate constraints ──────────────────────────────
    const now = new Date();

    if (promo.valid_from && new Date(promo.valid_from) > now) {
      return json({ valid: false, error: "Promo code is not yet active" });
    }

    if (promo.valid_until && new Date(promo.valid_until) < now) {
      return json({ valid: false, error: "Promo code has expired" });
    }

    if (promo.max_uses && promo.uses_count >= promo.max_uses) {
      return json({ valid: false, error: "Promo code has been fully redeemed" });
    }

    // Per-user cap — block if this buyer already redeemed it (Phase 5).
    if (promo.max_per_user && promo.max_per_user > 0) {
      const { count, error: countError } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("promo_code_id", promo.id)
        .eq("user_id", userId)
        .eq("status", "paid");
      if (countError) return json({ valid: false, error: "Could not verify promo usage. Please try again." }, 503);
      if ((count ?? 0) >= promo.max_per_user) {
        return json({ valid: false, error: "You've already used this code." });
      }
    }

    // ── Return discount info ──────────────────────────────
    return json({
      valid: true,
      code_kind: "promo",
      promo_code_id: promo.id,
      discount_type: promo.discount_type, // percent | fixed_cents | bogo
      discount_value: promo.discount_value,
      max_per_user: promo.max_per_user ?? null,
      code: promo.code,
    });
  } catch (err: any) {
    console.error("[validate-promo-code] Error:", err);
    return json({ error: "Could not validate the code. Please try again." }, 500);
  }
});
