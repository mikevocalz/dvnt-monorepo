/**
 * cart-release-hold Edge Function
 *
 * POST /cart-release-hold
 * Body: { cartId }
 *
 * Releases active holds for a buyer-owned cart. Deploy with --no-verify-jwt.
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    let body: { cartId?: string } = {};
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON", 400);
    }

    const cartId = String(body.cartId || "").trim();
    if (!UUID_RE.test(cartId)) return errorResponse("Invalid cartId", 400);

    const { data: cart, error: cartError } = await supabase
      .from("carts")
      .select("id, user_id, status")
      .eq("id", cartId)
      .maybeSingle();

    if (cartError) {
      console.error("[cart-release-hold] cart lookup failed", cartError);
      return errorResponse("Could not load cart", 500);
    }
    if (!cart || cart.user_id !== authId) {
      return errorResponse("Cart not found", 404);
    }
    if (cart.status === "completed") {
      return errorResponse("Cart already completed", 409);
    }

    console.log("[cart-release-hold] release requested", {
      cartId,
      userId: authId,
    });

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "cart_release_hold",
      { p_cart_id: cartId },
    );

    if (rpcError) {
      console.error("[cart-release-hold] release RPC failed", rpcError);
      return errorResponse("Could not release hold", 500);
    }

    console.log("[cart-release-hold] hold released", {
      cartId,
      releasedCount: rpcResult?.releasedCount ?? 0,
    });

    return jsonResponse({
      ok: true,
      cartId,
      releasedCount: rpcResult?.releasedCount ?? 0,
    });
  } catch (err) {
    console.error("[cart-release-hold] unexpected", err);
    return errorResponse("Internal error", 500);
  }
});
