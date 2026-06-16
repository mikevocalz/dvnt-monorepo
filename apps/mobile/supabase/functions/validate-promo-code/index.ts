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

    const { event_id, code, ticket_type_id } = await req.json();

    if (!event_id || !code) {
      return json({ valid: false, error: "Missing event_id or code" }, 400);
    }

    const normalizedCode = code.trim().toUpperCase();

    // ── Look up promo code ────────────────────────────────
    // Match by event_id + UPPER(code), optionally scoped to ticket_type
    let query = supabase
      .from("promo_codes")
      .select("*")
      .eq("event_id", parseInt(event_id))
      .ilike("code", normalizedCode);

    const { data: promos, error: promoError } = await query;

    if (promoError || !promos?.length) {
      return json({ valid: false, error: "Invalid promo code" });
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
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("promo_code_id", promo.id)
        .eq("user_id", userId)
        .eq("status", "paid");
      if ((count ?? 0) >= promo.max_per_user) {
        return json({ valid: false, error: "You've already used this code." });
      }
    }

    // ── Return discount info ──────────────────────────────
    return json({
      valid: true,
      promo_code_id: promo.id,
      discount_type: promo.discount_type, // percent | fixed_cents | bogo
      discount_value: promo.discount_value,
      max_per_user: promo.max_per_user ?? null,
      code: promo.code,
    });
  } catch (err: any) {
    console.error("[validate-promo-code] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
