/**
 * Cart-rail ticket issuance shared between the Stripe webhook
 * (payment_intent.succeeded, metadata.type === "cart_checkout") and the
 * reconcile-orders sweep. Extracted verbatim from stripe-webhook/index.ts.
 */

import { createSignedQrPayload } from "./hmac-qr.ts";
import { maybeFireCapacityAlerts } from "./capacity-alerts.ts";
import { recordPromoterEarning } from "./order-state.ts";

async function refundPaymentIntentForAllocationFailure(
  paymentIntentId: string,
  cartId: string,
): Promise<void> {
  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY") || ""}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `allocation_failure_${paymentIntentId}`,
    },
    body: new URLSearchParams({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
      // Full refund of a destination charge: reverse the organizer transfer
      // and our application fee too, or DVNT covers the whole amount out of
      // its own balance for a failure that is ours, not theirs.
      refund_application_fee: "true",
      reverse_transfer: "true",
      "metadata[cart_id]": cartId,
      "metadata[reason]": "system_allocation_failure",
    }).toString(),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || "Stripe refund failed");
  }
}

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
 * order_addons is one row per add-on LINE (quantity aggregated), so we
 * mint exactly ONE QR per REDEEMABLE add-on line — reusing the same
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

    // One QR per add-on LINE — order_addons is one aggregated row per line.
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

  return rows;
}

export async function handleCartPaymentIntentSucceeded(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  pi: any,
): Promise<boolean> {
  const metadata = pi.metadata || {};
  const cartId = metadata.cart_id;
  if (!cartId) return false;

  console.log("[stripe-webhook] Cart PI succeeded", {
    cartId,
    paymentIntentId: pi.id,
  });

  const preparedTicketRows = await prepareCartTicketRows(supabase, cartId);
  const preparedAddonRows = await prepareCartAddonRows(supabase, cartId);

  // Always pass all 4 named args (p_addon_rows is [] when the cart has no
  // add-ons) so PostgREST binds the 4-arg overload deterministically —
  // base migration 20260516150000 (3-arg) and 20260613000300 (4-arg) both
  // define cart_complete_issuance; a 3-arg named call would be ambiguous.
  // DEPENDENCY: the 4-arg overload lives in 20260613000300 — if only the
  // 3-arg is live, that migration must be applied or this RPC 404s.
  const { data: issuanceResult, error: issuanceError } = await supabase.rpc(
    "cart_complete_issuance",
    {
      p_cart_id: cartId,
      p_payment_intent_id: pi.id,
      p_ticket_rows: preparedTicketRows,
      p_addon_rows: preparedAddonRows,
    },
  );

  if (issuanceError) {
    console.error("[stripe-webhook] cart issuance RPC failed:", issuanceError);
    await refundPaymentIntentForAllocationFailure(pi.id, cartId);
    throw issuanceError;
  }

  if (!issuanceResult?.ok) {
    console.error("[stripe-webhook] cart issuance rejected:", issuanceResult);
    await refundPaymentIntentForAllocationFailure(pi.id, cartId);

    await supabase
      .from("orders")
      .update({
        status: "payment_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("cart_id", cartId);

    return true;
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
    .eq("cart_id", cartId);

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
        detail: `${issuanceResult.issuedCount} ticket(s) issued`,
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
