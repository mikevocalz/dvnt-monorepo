/**
 * promoter-ref
 *
 * Binds a valid tracked promoter link to the signed-in buyer's account.
 * Last valid click wins per event. Checkout still revalidates the promoter row,
 * status and discount policy; this is durable attribution intent, not authority.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { escapeLikePattern } from "../_shared/apply-promoter-code.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("claim"),
    event_id: z.number().int().positive(),
    code: z.string().trim().min(2).max(32),
  }),
  z.object({
    action: z.literal("get"),
    event_id: z.number().int().positive(),
  }),
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Service unavailable" }, 503);
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
    });

    const session = await verifySessionDetailed(supabase, req);
    if (!session.ok) {
      return json({ error: "Authentication required" }, 401);
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return json({ error: "Invalid promoter link request" }, 400);
    }

    if (parsed.data.action === "get") {
      const { data: claim, error: claimError } = await supabase
        .from("promoter_ref_claims")
        .select("promoter_id")
        .eq("buyer_auth_id", session.userId)
        .eq("event_id", parsed.data.event_id)
        .maybeSingle();

      if (claimError) {
        console.error("[promoter-ref] claim lookup failed:", claimError);
        return json({ error: "Could not load promoter discount" }, 500);
      }
      if (!claim?.promoter_id) {
        return json({ ok: true, claim: null });
      }

      const { data: savedPromoter, error: savedPromoterError } = await supabase
        .from("event_promoters")
        .select(
          "id, event_id, code, customer_discount_bps, promoter_commission_bps, status",
        )
        .eq("id", claim.promoter_id)
        .eq("event_id", parsed.data.event_id)
        .eq("status", "active")
        .maybeSingle();

      if (savedPromoterError) {
        console.error(
          "[promoter-ref] saved promoter lookup failed:",
          savedPromoterError,
        );
        return json({ error: "Could not load promoter discount" }, 500);
      }
      if (!savedPromoter) {
        return json({ ok: true, claim: null });
      }

      return json({
        ok: true,
        claim: {
          eventId: savedPromoter.event_id,
          promoterId: savedPromoter.id,
          code: savedPromoter.code,
          customerDiscountBps: savedPromoter.customer_discount_bps,
          promoterCommissionBps: savedPromoter.promoter_commission_bps,
        },
      });
    }

    const code = parsed.data.code.toUpperCase();
    if (!/^[A-Z0-9_-]{2,32}$/.test(code)) {
      return json({ error: "Invalid promoter code" }, 400);
    }

    const { data: promoter, error: promoterError } = await supabase
      .from("event_promoters")
      .select(
        "id, event_id, code, customer_discount_bps, promoter_commission_bps, status",
      )
      .eq("event_id", parsed.data.event_id)
      .ilike("code", escapeLikePattern(code))
      .eq("status", "active")
      .maybeSingle();

    if (promoterError) {
      console.error("[promoter-ref] promoter lookup failed:", promoterError);
      return json({ error: "Could not apply promoter link" }, 500);
    }
    if (!promoter) {
      return json({ error: "This promoter link is no longer active" }, 404);
    }

    const { error: claimError } = await supabase
      .from("promoter_ref_claims")
      .upsert(
        {
          buyer_auth_id: session.userId,
          event_id: parsed.data.event_id,
          promoter_id: promoter.id,
          code: promoter.code,
          captured_at: new Date().toISOString(),
        },
        { onConflict: "buyer_auth_id,event_id" },
      );

    if (claimError) {
      console.error("[promoter-ref] claim upsert failed:", claimError);
      return json({ error: "Could not save promoter discount" }, 500);
    }

    return json({
      ok: true,
      claim: {
        eventId: promoter.event_id,
        promoterId: promoter.id,
        code: promoter.code,
        customerDiscountBps: promoter.customer_discount_bps,
        promoterCommissionBps: promoter.promoter_commission_bps,
      },
    });
  } catch (error) {
    console.error("[promoter-ref] unexpected error:", error);
    return json({ error: "Could not save promoter discount" }, 500);
  }
});
