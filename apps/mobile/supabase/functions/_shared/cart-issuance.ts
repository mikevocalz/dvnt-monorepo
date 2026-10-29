/**
 * Cart-rail ticket issuance shared between the Stripe webhook
 * (payment_intent.succeeded, metadata.type === "cart_checkout") and the
 * reconcile-orders sweep. Extracted verbatim from stripe-webhook/index.ts.
 */

import { createSignedQrPayload } from "./hmac-qr.ts";
import { maybeFireCapacityAlerts } from "./capacity-alerts.ts";
import { recordPromoterEarning } from "./order-state.ts";
import { confirmCartPayment } from "./confirmed-cart-payment.ts";

async function prepareCartTicketRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  cartId: string,
): Promise<
  {
    ticket_id: string;
    line_item_id: string;
    qr_token: string;
    qr_payload: string;
  }[]
> {
  // TICKET lines only. Add-on lines have tier_id NULL → the
  // ticket_types(event_id) join returns null → Number(null)=NaN, which
  // previously threw "Invalid event…" and auto-refunded the whole order
  // (CRITICAL money bug). Add-on lines are issued separately via
  // prepareCartAddonRows → cart_complete_issuance(p_addon_rows).
  const { data: lineItems, error } = await supabase
    .from("cart_line_items")
    .select("id, quantity, ticket_types(event_id)")
    .eq("cart_id", cartId)
    .not("tier_id", "is", null)
    .order("created_at", { ascending: true });

  if (error) throw error;
  // A cart may be add-ons only (standalone merch) → zero ticket lines is
  // valid; cart_complete_issuance still completes it from p_addon_rows.
  if (!lineItems?.length) {
    return [];
  }

  const preparedRows: {
    ticket_id: string;
    line_item_id: string;
    qr_token: string;
    qr_payload: string;
  }[] = [];

  for (const lineItem of lineItems) {
    const eventId = Number(lineItem.ticket_types?.event_id);
    const quantity = Number(lineItem.quantity);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      throw new Error(`Invalid event for cart line item ${lineItem.id}`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity for cart line item ${lineItem.id}`);
    }

    for (let i = 0; i < quantity; i++) {
      const ticketId = crypto.randomUUID();
      const { qrToken, qrPayload } = await createSignedQrPayload(
        ticketId,
        eventId,
      );

      preparedRows.push({
        ticket_id: ticketId,
        line_item_id: lineItem.id,
        qr_token: qrToken,
        qr_payload: qrPayload,
      });
    }
  }

  return preparedRows;
}

/**
 * Build p_addon_rows for cart_complete_issuance's 4-arg overload
 * (migration 20260613000300). Add-on cart lines carry tier_id NULL and
 * addon_id set; they are NOT ticket rows.
 *
 * A REDEEMABLE add-on line gets one QR per unit, and cart_complete_issuance
 * (20261009100200) writes one order_addons row per unit, because the door
 * spends a whole row on one scan. QRs are minted with the same
 * `createSignedQrPayload(id, eventId)` HMAC mint tickets use (hmac-qr.ts).
 * The signed id is a fresh UUID standing in for the redeemable token; the
 * add-on's event_id is the eid. The migration's add-on loop writes
 * qr_token/qr_payload onto order_addons only when the add-on is_redeemable
 * (`CASE WHEN is_redeemable ...`), so non-redeemable lines need no entry
 * here — a missing p_addon_rows row yields NULL qr, matching that CASE.
 *
 * Shape MUST match the migration's jsonb_to_recordset columns exactly:
 *   prepared(line_item_id uuid, qr_token text, qr_payload text)
 */
async function prepareCartAddonRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  cartId: string,
): Promise<
  {
    line_item_id: string;
    qr_token: string;
    qr_payload: string;
  }[]
> {
  const { data: addonLines, error } = await supabase
    .from("cart_line_items")
    .select("id, quantity, ticket_addons(event_id, is_redeemable)")
    .eq("cart_id", cartId)
    .not("addon_id", "is", null)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows: {
    line_item_id: string;
    qr_token: string;
    qr_payload: string;
  }[] = [];

  for (const line of addonLines || []) {
    const addon = Array.isArray(line.ticket_addons)
      ? line.ticket_addons[0]
      : line.ticket_addons;
    // Only redeemable add-ons get a door QR (matches migration CASE).
    if (!addon?.is_redeemable) continue;

    const eventId = Number(addon?.event_id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      throw new Error(`Invalid event for cart add-on line ${line.id}`);
    }

    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity for cart add-on line ${line.id}`);
    }

    // One QR per UNIT. redeem_addon spends a whole order_addons row on one
    // scan, so cart_complete_issuance (20261009100200) writes one row per
    // unit when it receives exactly `quantity` QRs for the line.
    for (let i = 0; i < quantity; i++) {
      const { qrToken, qrPayload } = await createSignedQrPayload(
        crypto.randomUUID(),
        eventId,
      );
      rows.push({
        line_item_id: line.id,
        qr_token: qrToken,
        qr_payload: qrPayload,
      });
    }
  }

  return rows;
}

/** Fulfill only against fresh Stripe evidence; never automatically refund. */
export async function handleCartPaymentIntentSucceeded(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  pi: any,
  options: { eventCreatedAt?: string } = {},
): Promise<boolean> {
  // The webhook may be retried after a refund/dispute or after a failed attempt.
  // Always fetch current payment state before restoring any inventory.
  pi = await confirmCartPayment(pi);
  const metadata = pi.metadata || {};
  const cartId = metadata.cart_id;
  if (!cartId) return false;

  console.log("[stripe-webhook] Cart PI succeeded", {
    cartId,
    paymentIntentId: pi.id,
  });

  const preparedTicketRows = await prepareCartTicketRows(supabase, cartId);
  const preparedAddonRows = await prepareCartAddonRows(supabase, cartId);

  const { data: issuanceResult, error: issuanceError } = await supabase.rpc(
    "complete_paid_cart_atomic",
    {
      p_cart_id: cartId,
      p_payment_intent_id: pi.id,
      p_amount_received: pi.amount_received,
      p_currency: pi.currency,
      p_user_id: metadata.user_id,
      p_event_id: Number(metadata.event_id),
      p_ticket_rows: preparedTicketRows,
      p_addon_rows: preparedAddonRows,
      p_event_created_at: options.eventCreatedAt ?? null,
    },
  );

  if (issuanceError) {
    console.error("[stripe-webhook] cart issuance RPC failed:", issuanceError);
    throw issuanceError;
  }
  if (!issuanceResult?.ok) {
    console.error("[stripe-webhook] cart issuance rejected:", issuanceResult);
    const { data: blockedOrder } = await supabase.from("orders")
      .select("id").eq("cart_id", cartId).maybeSingle();
    if (blockedOrder?.id) {
      // Keep a confirmed paid attempt discoverable by the ordinary retry sweep.
      // Never overwrite a concurrent success/refund or a replacement PI.
      const { error: retryError } = await supabase.from("orders")
        .update({ status: "payment_pending", updated_at: new Date().toISOString() })
        .eq("id", blockedOrder.id).eq("cart_id", cartId)
        .eq("stripe_payment_intent_id", pi.id)
        .eq("status", "payment_failed").is("refunded_at", null);
      if (retryError) throw retryError;
      await supabase.from("order_timeline").insert({
        order_id: blockedOrder.id,
        type: "reconcile_blocked",
        label: "Paid purchase needs fulfillment review",
        detail: `Cart fulfillment was blocked (${issuanceResult?.error ?? "unknown"}). ` +
          "Payment was verified; no automatic refund or partial allocation was made. " +
          "Tickets and add-ons require inventory-safe recovery.",
      });
    }
    return false;
  }

  if (issuanceResult.duplicate) {
    console.log("[stripe-webhook] Cart already completed, skipping issuance", {
      cartId,
      issuedCount: issuanceResult.issuedCount,
    });
    return true;
  }

  const { data: lineItems } = await supabase
    .from("cart_line_items")
    .select("tier_id")
    .eq("cart_id", cartId)
    // Add-on lines have no tier; capacity alerts are per ticket tier.
    .not("tier_id", "is", null);

  const seenTierIds = new Set<string>();
  for (const line of lineItems || []) {
    const tierId = String(line.tier_id);
    if (seenTierIds.has(tierId)) continue;
    seenTierIds.add(tierId);
    await maybeFireCapacityAlerts(supabase, {
      eventId: parseInt(metadata.event_id),
      ticketTypeId: tierId,
    });
  }

  const { data: orderRow } = await supabase
    .from("orders")
    .select("id")
    .eq("cart_id", cartId)
    .maybeSingle();

  if (orderRow?.id) {
    await supabase.from("order_timeline").insert([
      {
        order_id: orderRow.id,
        type: "payment_authorized",
        label: "Payment authorized",
      },
      {
        order_id: orderRow.id,
        type: "payment_captured",
        label: "Payment captured",
        detail: "Purchased tickets and add-ons fulfilled",
      },
    ]);

    // Promoter attribution + rev-share earning (WS-4) — idempotent.
    await recordPromoterEarning(
      supabase,
      orderRow.id,
      metadata.dvnt_promoter_code || null,
    );
  }

  console.log("[stripe-webhook] Cart issuance complete", {
    cartId,
    issuedCount: issuanceResult.issuedCount,
  });

  return true;
}
