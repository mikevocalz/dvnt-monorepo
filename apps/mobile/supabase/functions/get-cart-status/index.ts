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

    const { data: cart, error: cartError } = await supabase
      .from("carts")
      .select(
        "id, user_id, event_id, status, stripe_pi_id, total_cents, fee_cents, tax_cents, currency, created_at, updated_at",
      )
      .eq("id", cartId)
      .maybeSingle();

    if (cartError) {
      console.error("[get-cart-status] cart lookup failed", cartError);
      return errorResponse("Could not load cart", 500);
    }
    if (!cart || cart.user_id !== authId) {
      return errorResponse("Cart not found", 404);
    }

    const { data: lineItems, error: lineItemsError } = await supabase
      .from("cart_line_items")
      .select(
        "id, category, tier_id, quantity, unit_price_cents, refunded_amount_cents, metadata, ticket_types(name, price_cents, category)",
      )
      .eq("cart_id", cartId)
      .order("created_at", { ascending: true });

    if (lineItemsError) {
      console.error(
        "[get-cart-status] line item lookup failed",
        lineItemsError,
      );
      return errorResponse("Could not load cart line items", 500);
    }

    const { data: activeHolds, error: holdsError } = await supabase
      .from("cart_holds")
      .select("id, line_item_id, tier_id, qty, expires_at")
      .eq("cart_id", cartId)
      .eq("released", false)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true });

    if (holdsError) {
      console.error("[get-cart-status] hold lookup failed", holdsError);
      return errorResponse("Could not load cart holds", 500);
    }

    const { data: tickets, error: ticketsError } = await supabase
      .from("tickets")
      .select(
        "id, event_id, ticket_type_id, status, qr_token, qr_payload, purchase_amount_cents, category, cart_id, cart_line_item_id, created_at, ticket_types(name), events(title, cover_image_url, start_date, end_date, location)",
      )
      .eq("cart_id", cartId)
      .eq("user_id", authId)
      .order("created_at", { ascending: true });

    if (ticketsError) {
      console.error("[get-cart-status] ticket lookup failed", ticketsError);
      return errorResponse("Could not load issued tickets", 500);
    }

    const activeHoldExpiresAt = activeHolds?.[0]?.expires_at ?? null;
    const issuedTickets = (tickets || []).map((ticket: any) => ({
      ...ticket,
      ticket_type_name: ticket.ticket_types?.name || "General",
      event_title: ticket.events?.title || "",
      event_image: ticket.events?.cover_image_url || "",
      event_date: ticket.events?.start_date || "",
      event_end_date: ticket.events?.end_date || null,
      event_location: ticket.events?.location || "",
    }));

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
        tierId: item.tier_id,
        tierName: item.ticket_types?.name || "General",
        quantity: item.quantity,
        unitPriceCents: item.ticket_types?.price_cents ?? item.unit_price_cents,
        refundedAmountCents: item.refunded_amount_cents,
        metadata: item.metadata || {},
      })),
      holds: {
        active: (activeHolds || []).length > 0,
        expiresAt: activeHoldExpiresAt,
        items: activeHolds || [],
      },
      tickets: issuedTickets,
      completed: cart.status === "completed",
    });
  } catch (err) {
    console.error("[get-cart-status] unexpected", err);
    return errorResponse("Internal error", 500);
  }
});
