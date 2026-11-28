import { cartFulfillmentSnapshot } from "../_shared/cart-fulfillment.ts";
/**
 * get-cart-status Edge Function
 *
 * POST /get-cart-status
 * Body: { cartId }
 *
 * Recovery endpoint for native PaymentSheet. The server is source of truth:
 * if the app backgrounds or loses network after payment confirmation, call
 * this endpoint on foreground to decide whether to navigate to success.
 * Deploy with --no-verify-jwt.
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

    // One PostgREST relationship statement: counts, ownership and financial
    // status come from the same MVCC snapshot. Counts detect truncated embeds.
    const { data: cart, error: cartError } = await supabase.from("carts").select(`
      id,user_id,event_id,status,stripe_pi_id,total_cents,fee_cents,tax_cents,currency,updated_at,
      line_count:cart_line_items!cart_id(count),ticket_count:tickets!cart_id(count),
      addon_count:order_addons!cart_id(count),order_count:orders!cart_id(count),
      line_items:cart_line_items!cart_id(id,cart_id,category,tier_id,addon_id,variant_id,quantity,unit_price_cents,refunded_amount_cents,metadata,ticket_types(name),ticket_addons(name)),
      order_rows:orders!cart_id(id,cart_id,user_id,event_id,status,currency,total_cents,paid_at,stripe_payment_intent_id),
      ticket_rows:tickets!cart_id(id,user_id,order_id,event_id,ticket_type_id,status,qr_token,qr_payload,purchase_amount_cents,category,cart_id,cart_line_item_id,ticket_types(name),events(title,cover_image_url,start_date,end_date,location)),
      addon_rows:order_addons!cart_id(id,user_id,order_id,event_id,cart_id,cart_line_item_id,ticket_id,addon_id,variant_id,quantity,unit_price_cents,status,qr_token,qr_payload,ticket_addons(name,is_redeemable),ticket_addon_variants(name),bound_ticket:tickets!ticket_id(id,user_id,status,event_id)),
      hold_rows:cart_holds!cart_id(id,line_item_id,tier_id,addon_id,variant_id,qty,expires_at,released)
    `).eq("id", cartId).eq("user_id", authId).maybeSingle();
    if (cartError) return errorResponse("Could not verify cart status", 500);
    if (!cart || cart.user_id !== authId) return errorResponse("Cart not found", 404);
    const snapshot = cartFulfillmentSnapshot(cart, authId);
    const lineItems = Array.isArray(cart.line_items) ? cart.line_items : [];
    const activeHolds = (Array.isArray(cart.hold_rows) ? cart.hold_rows : [])
      .filter((hold: any) => hold.released === false && Date.parse(hold.expires_at) > Date.now())
      .sort((a: any,b: any) => String(a.expires_at).localeCompare(String(b.expires_at)));
    const activeHoldExpiresAt = activeHolds[0]?.expires_at ?? null;

    return jsonResponse({
      ok: true,
      cart: {
        id: cart.id,
        eventId: cart.event_id,
        status: cart.status,
        paymentIntentId: cart.stripe_pi_id,
        totalCents: cart.total_cents,
        feeCents: cart.fee_cents,
        taxCents: cart.tax_cents,
        currency: cart.currency,
        updatedAt: cart.updated_at,
      },
      lineItems: (lineItems || []).map((item: any) => ({
        id: item.id,
        category: item.category,
        // Addon lines have tier_id NULL — the DTO's back-compat convention
        // carries the addon id on tierId with addonId set explicitly too.
        tierId: item.tier_id ?? item.addon_id,
        tierName:
          item.ticket_types?.name || item.ticket_addons?.name || "General",
        quantity: item.quantity,
        // Receipt prices are the original held snapshot, not today's catalog.
        unitPriceCents: item.unit_price_cents,
        refundedAmountCents: item.refunded_amount_cents,
        metadata: item.metadata || {},
        addonId: item.addon_id ?? null,
        variantId: item.variant_id ?? null,
      })),
      holds: {
        active: (activeHolds || []).length > 0,
        expiresAt: activeHoldExpiresAt,
        items: activeHolds || [],
      },
      tickets: snapshot.tickets,
      addons: snapshot.addons,
      fulfillment: snapshot.fulfillment,
      completed: cart.status === "completed",
    });
  } catch (err) {
    console.error("[get-cart-status] unexpected", err);
    return errorResponse("Internal error", 500);
  }
});
