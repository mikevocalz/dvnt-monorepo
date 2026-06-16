/**
 * cart-line-refund Edge Function
 *
 * POST /cart-line-refund
 * Body: { cartId, lineItemId }
 *
 * Issues one Stripe refund for a single mixed-cart line item and atomically
 * marks only that line's tickets refunded. Deploy with --no-verify-jwt.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyNextWaitlister } from "../_shared/notify-waitlisters.ts";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { voidWalletPass } from "../_shared/wallet-push.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[cart-line-refund] FATAL: STRIPE_SECRET_KEY env var is not set.",
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ParsedBody = {
  cartId: string;
  lineItemId: string;
};

type CartRow = {
  id: string;
  user_id: string;
  event_id: number;
  status: string;
  stripe_pi_id?: string | null;
};

type CartLineItemRow = {
  id: string;
  cart_id: string;
  category: "admission" | "coat_check";
  tier_id: string;
  quantity: number;
  unit_price_cents: number;
  refunded_amount_cents: number;
};

type TicketRow = {
  id: string;
  event_id: number;
  ticket_type_id?: string | null;
};

function parseBody(input: unknown): ParsedBody | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const cartId = String((input as Record<string, unknown>).cartId || "").trim();
  const lineItemId = String(
    (input as Record<string, unknown>).lineItemId || "",
  ).trim();
  if (!UUID_RE.test(cartId) || !UUID_RE.test(lineItemId)) return null;
  return { cartId, lineItemId };
}

async function stripeRefund(
  params: Record<string, string>,
  idempotencyKey: string,
): Promise<any> {
  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || "Stripe refund failed");
  }
  return data;
}

async function notifyReleasedInventory(
  supabase: any,
  ticketRows: TicketRow[],
): Promise<void> {
  const perTier = new Map<string, number>();
  for (const ticket of ticketRows) {
    if (!ticket.ticket_type_id) continue;
    perTier.set(
      String(ticket.ticket_type_id),
      (perTier.get(String(ticket.ticket_type_id)) ?? 0) + 1,
    );
  }

  for (const [typeId, count] of perTier) {
    const { data: tt } = await supabase
      .from("ticket_types")
      .select("quantity_sold, name, event_id")
      .eq("id", typeId)
      .maybeSingle();
    if (!tt) continue;

    await supabase
      .from("ticket_types")
      .update({
        quantity_sold: Math.max(0, (tt.quantity_sold ?? 0) - count),
      })
      .eq("id", typeId);

    const { data: ev } = await supabase
      .from("events")
      .select("title")
      .eq("id", tt.event_id)
      .maybeSingle();

    for (let i = 0; i < count; i++) {
      await notifyNextWaitlister(supabase, {
        eventId: tt.event_id,
        ticketTypeId: typeId,
        tierName: tt.name,
        eventTitle: ev?.title ?? null,
      });
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  if (!STRIPE_SECRET_KEY) {
    return errorResponse(
      "Stripe is not configured for this environment. Contact support.",
      503,
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return errorResponse("Unauthorized", 401);

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return errorResponse("Invalid JSON", 400);
    }

    const body = parseBody(parsed);
    if (!body) return errorResponse("Invalid cartId or lineItemId", 400);

    console.log("[cart-line-refund] refund requested", {
      cartId: body.cartId,
      lineItemId: body.lineItemId,
      userId: authId,
    });

    const { data: cart, error: cartError } = await supabase
      .from("carts")
      .select("id, user_id, event_id, status, stripe_pi_id")
      .eq("id", body.cartId)
      .maybeSingle();

    if (cartError) {
      console.error("[cart-line-refund] cart lookup failed", cartError);
      return errorResponse("Could not load cart", 500);
    }
    if (!cart || (cart as CartRow).user_id !== authId) {
      return errorResponse("Cart not found", 404);
    }
    const cartRow = cart as CartRow;
    if (cartRow.status !== "completed") {
      return errorResponse("Only completed carts can be refunded", 409);
    }
    if (!cartRow.stripe_pi_id) {
      return errorResponse("Cart has no payment to refund", 400);
    }

    const { data: event } = await supabase
      .from("events")
      .select("start_date")
      .eq("id", cartRow.event_id)
      .maybeSingle();
    if (event?.start_date) {
      const msUntilEvent = new Date(event.start_date).getTime() - Date.now();
      if (msUntilEvent <= 24 * 60 * 60 * 1000) {
        return errorResponse("Refund window has closed", 400);
      }
    }

    const { data: lineItem, error: lineItemError } = await supabase
      .from("cart_line_items")
      .select(
        "id, cart_id, category, tier_id, quantity, unit_price_cents, refunded_amount_cents",
      )
      .eq("id", body.lineItemId)
      .eq("cart_id", body.cartId)
      .maybeSingle();

    if (lineItemError) {
      console.error(
        "[cart-line-refund] line item lookup failed",
        lineItemError,
      );
      return errorResponse("Could not load cart line item", 500);
    }
    if (!lineItem) return errorResponse("Cart line item not found", 404);

    const item = lineItem as CartLineItemRow;
    const lineTotalCents = item.unit_price_cents * item.quantity;
    const refundAmountCents = lineTotalCents - item.refunded_amount_cents;
    if (refundAmountCents <= 0) {
      return errorResponse("Cart line item is already refunded", 409);
    }

    const { data: activeTickets, error: activeTicketsError } = await supabase
      .from("tickets")
      .select("id")
      .eq("cart_id", body.cartId)
      .eq("cart_line_item_id", body.lineItemId)
      .eq("user_id", authId)
      .eq("status", "active");

    if (activeTicketsError) {
      console.error(
        "[cart-line-refund] active ticket lookup failed",
        activeTicketsError,
      );
      return errorResponse("Could not verify refundable tickets", 500);
    }
    if (!activeTickets?.length) {
      return errorResponse("No active tickets remain on this line item", 409);
    }

    const idempotencyKey = `cart_line_refund_${body.lineItemId}_${refundAmountCents}`;

    const { data: existingRefund } = await supabase
      .from("cart_line_refunds")
      .select("id, status, stripe_refund_id, amount_cents")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingRefund?.status === "succeeded") {
      return jsonResponse({
        ok: true,
        cartId: body.cartId,
        lineItemId: body.lineItemId,
        refundId: existingRefund.stripe_refund_id,
        amountCents: existingRefund.amount_cents,
        message: "Refund already processed for this line item",
      });
    }

    if (!existingRefund) {
      await supabase.from("cart_line_refunds").insert({
        cart_id: body.cartId,
        line_item_id: body.lineItemId,
        stripe_payment_intent_id: cartRow.stripe_pi_id,
        amount_cents: refundAmountCents,
        idempotency_key: idempotencyKey,
        status: "pending",
      });
    }

    const refund = await stripeRefund(
      {
        payment_intent: cartRow.stripe_pi_id,
        amount: String(refundAmountCents),
        reason: "requested_by_customer",
        "metadata[cart_id]": body.cartId,
        "metadata[line_item_id]": body.lineItemId,
        "metadata[cart_line_item_id]": body.lineItemId,
        "metadata[refund_initiator]": "buyer",
        "metadata[buyer_auth_id]": authId,
      },
      idempotencyKey,
    );

    const { data: applied, error: applyError } = await supabase.rpc(
      "cart_apply_line_refund",
      {
        p_cart_id: body.cartId,
        p_line_item_id: body.lineItemId,
        p_stripe_refund_id: refund.id,
        p_amount_cents: refundAmountCents,
        p_idempotency_key: idempotencyKey,
      },
    );

    if (applyError) {
      console.error("[cart-line-refund] apply refund failed", applyError);
      await supabase
        .from("cart_line_refunds")
        .update({
          stripe_refund_id: refund.id,
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("idempotency_key", idempotencyKey);
      return errorResponse(
        "Refund was accepted by Stripe but ticket sync failed. Support has been notified.",
        500,
      );
    }

    const ticketRows = Array.isArray(applied?.ticketRows)
      ? (applied.ticketRows as TicketRow[])
      : [];

    await notifyReleasedInventory(supabase, ticketRows);
    for (const ticket of ticketRows) {
      await voidWalletPass(supabase, ticket.id);
    }

    return jsonResponse({
      ok: true,
      cartId: body.cartId,
      lineItemId: body.lineItemId,
      refundId: refund.id,
      amountCents: refundAmountCents,
      message:
        "Refund issued for this line item. Other tickets in the cart remain active.",
    });
  } catch (err: any) {
    console.error("[cart-line-refund]", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
