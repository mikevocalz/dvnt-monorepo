/**
 * Stripe Webhook Handler (Edge Function)
 *
 * Handles:
 *   - checkout.session.completed → issue tickets OR grant sneaky access
 *   - payment_intent.succeeded → native PaymentSheet ticket issuance
 *   - payment_intent.payment_failed → release holds, mark order failed
 *   - charge.refunded → mark ticket refunded
 *   - charge.dispute.created → flag payout on_hold
 *   - charge.dispute.closed → resolve dispute, update order/payout
 *   - account.updated → sync organizer account status
 *   - transfer.reversed → handle reversed transfers
 *   - payout.failed → handle failed payouts to connected accounts
 *   - radar.early_fraud_warning.created → flag suspicious orders
 *   - customer.subscription.created/updated/deleted → sneaky subscription lifecycle
 *   - invoice.payment_failed → mark subscription past_due
 *   - invoice.paid → confirm subscription renewal
 *
 * IDEMPOTENT: Uses stripe_events table to deduplicate.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computePayoutReleaseAt } from "../_shared/business-days.ts";
import { createSignedQrPayload } from "../_shared/hmac-qr.ts";
import { notifyEventOrganizers } from "../_shared/notify-event-organizers.ts";
import { maybeFireCapacityAlerts } from "../_shared/capacity-alerts.ts";
import { notifyNextWaitlister } from "../_shared/notify-waitlisters.ts";
import {
  sendResendEmail,
  ticketConfirmation,
} from "../_shared/send-resend-email.ts";
import { voidWalletPass } from "../_shared/wallet-push.ts";
import { incrementPromoUsage } from "../_shared/apply-promo-code.ts";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const STRIPE_WEBHOOK_SECRET_CONNECT =
  Deno.env.get("STRIPE_WEBHOOK_SECRET_CONNECT") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live").replace(/\/$/, "");

/**
 * Send a guest the QR + lookup link for the tickets they just bought.
 * Throws on Resend failure so the caller can decide whether to retry.
 */
async function sendGuestTicketEmail(
  to: string,
  name: string | null,
  eventTitle: string,
  startDate: string | null,
  location: string | null,
  tickets: {
    id: string;
    qr_token: string;
    guest_lookup_token: string | null;
  }[],
  opts: {
    tier?: string | null;
    tierLabel?: string | null;
    flyerUrl?: string | null;
    dominantColor?: string | null;
  } = {},
): Promise<void> {
  const greeting = `${name ? `Hey ${name}, ` : ""}Show ${
    tickets.length > 1 ? "these QR codes" : "this QR code"
  } at the door. We've attached your purchase to ${to} — keep this email handy.`;
  const dateLine = startDate
    ? new Date(startDate).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const messageId = await sendResendEmail({
    to,
    ...ticketConfirmation({
      eventTitle,
      dateLine,
      location,
      flyerUrl: opts.flyerUrl ?? null,
      dominantColor: opts.dominantColor ?? null,
      greeting,
      toEmail: to,
      tickets: tickets.map((t) => ({
        tier: opts.tier ?? "ga",
        tierLabel: opts.tierLabel ?? null,
        qrToken: t.qr_token,
        lookupUrl: t.guest_lookup_token
          ? `${SITE_URL}/public/tickets/guest/${t.guest_lookup_token}`
          : null,
      })),
    }),
  });
  if (messageId) {
    console.log(
      `[stripe-webhook] guest ticket email sent to ${to} (id ${messageId})`,
    );
  }
}

// Stripe signature verification (manual HMAC for Deno)
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    const parts = sigHeader
      .split(",")
      .reduce((acc: Record<string, string>, part: string) => {
        const [k, v] = part.split("=");
        acc[k.trim()] = v;
        return acc;
      }, {});

    const timestamp = parts["t"];
    const signature = parts["v1"];
    if (!timestamp || !signature) return false;

    // Tolerance: 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedPayload),
    );
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expected === signature;
  } catch (err) {
    console.error("[stripe-webhook] Signature verification error:", err);
    return false;
  }
}

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
  const { data: lineItems, error } = await supabase
    .from("cart_line_items")
    .select("id, quantity, ticket_types(event_id)")
    .eq("cart_id", cartId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  if (!lineItems?.length) {
    throw new Error("Cart has no line items");
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

async function handleCartPaymentIntentSucceeded(
  supabase: any,
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

  const { data: issuanceResult, error: issuanceError } = await supabase.rpc(
    "cart_complete_issuance",
    {
      p_cart_id: cartId,
      p_payment_intent_id: pi.id,
      p_ticket_rows: preparedTicketRows,
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
  }

  console.log("[stripe-webhook] Cart issuance complete", {
    cartId,
    issuedCount: issuanceResult.issuedCount,
  });

  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Hard-fail if no webhook secret is configured — never skip signature verification.
  // A missing secret means anyone could POST fake events and issue tickets, grant access,
  // or trigger refunds without paying.
  if (!STRIPE_WEBHOOK_SECRET && !STRIPE_WEBHOOK_SECRET_CONNECT) {
    console.error(
      "[stripe-webhook] No webhook secret configured (STRIPE_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET_CONNECT) — rejecting request",
    );
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const body = await req.text();
  const sigHeader = req.headers.get("stripe-signature") || "";

  // Two destinations send to this endpoint — one for "Your account" platform
  // events (payments, refunds, subscriptions), one for "Connected accounts"
  // events (account.updated, host payouts). Each destination has its own
  // signing secret, so we try both in order.
  let valid = false;
  if (STRIPE_WEBHOOK_SECRET) {
    valid = await verifyStripeSignature(body, sigHeader, STRIPE_WEBHOOK_SECRET);
  }
  if (!valid && STRIPE_WEBHOOK_SECRET_CONNECT) {
    valid = await verifyStripeSignature(
      body,
      sigHeader,
      STRIPE_WEBHOOK_SECRET_CONNECT,
    );
  }
  if (!valid) {
    console.error("[stripe-webhook] Invalid signature");
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(body);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  });

  // ── Idempotency check ──────────────────────────────────────
  const { error: dupeError } = await supabase
    .from("stripe_events")
    .insert({ event_id: event.id, event_type: event.type })
    .single();

  if (dupeError?.code === "23505") {
    console.log("[stripe-webhook] Duplicate event, skipping:", event.id);
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("[stripe-webhook] Processing:", event.type, event.id);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const metadata = session.metadata || {};

        if (metadata.type === "event_ticket") {
          // ── Issue tickets ────────────────────────────────
          const eventId = parseInt(metadata.event_id);
          const ticketTypeId = metadata.ticket_type_id;
          const userId = metadata.user_id || null;
          const guestEmail = metadata.guest_email || null;
          const guestName = metadata.guest_name || null;
          const isGuestPurchase = !userId && !!guestEmail;
          const quantity = parseInt(metadata.quantity) || 1;
          const amountCents = session.amount_total || 0;
          // Per-ticket attendee names for named tickets / group orders ("Ticket
          // N of M"). Optional JSON array in metadata.
          let attendeeNames: string[] = [];
          try {
            attendeeNames = metadata.attendee_names
              ? JSON.parse(metadata.attendee_names)
              : [];
          } catch {
            attendeeNames = [];
          }

          const ticketRows = [];
          for (let i = 0; i < quantity; i++) {
            const ticketUuid = crypto.randomUUID();
            const { qrToken, qrPayload } = await createSignedQrPayload(
              ticketUuid,
              eventId,
            );
            const attendeeName =
              attendeeNames[i] && String(attendeeNames[i]).trim()
                ? String(attendeeNames[i]).trim()
                : null;
            ticketRows.push({
              id: ticketUuid,
              event_id: eventId,
              ticket_type_id: ticketTypeId,
              user_id: userId,
              guest_email: guestEmail,
              guest_name: guestName,
              guest_lookup_token: isGuestPurchase ? crypto.randomUUID() : null,
              status: "active",
              qr_token: qrToken,
              qr_payload: qrPayload,
              stripe_checkout_session_id: session.id,
              stripe_payment_intent_id: session.payment_intent,
              purchase_amount_cents: Math.round(amountCents / quantity),
              // Group-order position + per-ticket name (Phase 5.6.5a).
              order_index: i + 1,
              order_count: quantity,
              attendee_name: attendeeName,
            });
          }

          const { data: insertedTickets, error: ticketError } = await supabase
            .from("tickets")
            .insert(ticketRows)
            .select("id, qr_token, guest_lookup_token");

          // Convert inventory hold to prevent double-counting
          await supabase
            .from("ticket_holds")
            .update({ status: "converted" })
            .eq("payment_intent_id", session.id)
            .eq("status", "active");

          if (ticketError) {
            console.error("[stripe-webhook] Ticket insert error:", ticketError);
            throw ticketError;
          }

          // Increment quantity_sold
          const { error: incError } = await supabase.rpc("increment_counter", {
            table_name: "ticket_types",
            column_name: "quantity_sold",
            row_id: ticketTypeId,
            amount: quantity,
          });

          // Fallback if RPC doesn't exist: direct update
          if (incError) {
            const { data: tt } = await supabase
              .from("ticket_types")
              .select("quantity_sold")
              .eq("id", ticketTypeId)
              .single();
            await supabase
              .from("ticket_types")
              .update({ quantity_sold: (tt?.quantity_sold || 0) + quantity })
              .eq("id", ticketTypeId);
          }

          // Capacity milestone alerts (75 / 90 / 100 %) — idempotent
          await maybeFireCapacityAlerts(supabase, {
            eventId,
            ticketTypeId,
          });

          // ── Promo usage — increment here (after confirmed payment), NOT at checkout time.
          // Incrementing at checkout creation would inflate usage counts for abandoned sessions.
          if (metadata.promo_code_id) {
            await incrementPromoUsage(supabase, metadata.promo_code_id);
          }

          // ── Guest tickets: email confirmation with QR + lookup link ──
          if (
            isGuestPurchase &&
            insertedTickets &&
            insertedTickets.length > 0
          ) {
            try {
              const { data: eventRow } = await supabase
                .from("events")
                .select(
                  "title, start_date, location_name, location_address, flyer_image_url, dominant_color",
                )
                .eq("id", eventId)
                .maybeSingle();
              const { data: ttRow } = await supabase
                .from("ticket_types")
                .select("name, category")
                .eq("id", ticketTypeId)
                .maybeSingle();
              await sendGuestTicketEmail(
                guestEmail!,
                guestName,
                eventRow?.title || "your event",
                eventRow?.start_date || null,
                eventRow?.location_name || eventRow?.location_address || null,
                insertedTickets,
                {
                  tier: ttRow?.category ?? null,
                  tierLabel: ttRow?.name ?? null,
                  flyerUrl: eventRow?.flyer_image_url ?? null,
                  dominantColor: eventRow?.dominant_color ?? null,
                },
              );
            } catch (mailErr) {
              // Email failure should not roll back the ticket — log and move on.
              console.error(
                "[stripe-webhook] guest email send failed:",
                mailErr,
              );
            }
          }

          // ── Update order → paid + add timeline ────────
          const { data: orderRow } = await supabase
            .from("orders")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .single();

          if (orderRow) {
            // Get payment method details from charge
            let pmBrand = null;
            let pmLast4 = null;
            if (session.payment_intent) {
              try {
                const piRes = await fetch(
                  `https://api.stripe.com/v1/payment_intents/${session.payment_intent}`,
                  {
                    headers: {
                      Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY") || ""}`,
                    },
                  },
                );
                const pi = await piRes.json();
                if (pi.latest_charge) {
                  const chargeRes = await fetch(
                    `https://api.stripe.com/v1/charges/${pi.latest_charge}`,
                    {
                      headers: {
                        Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY") || ""}`,
                      },
                    },
                  );
                  const charge = await chargeRes.json();
                  pmBrand = charge.payment_method_details?.card?.brand || null;
                  pmLast4 = charge.payment_method_details?.card?.last4 || null;
                }
              } catch (e) {
                console.error("[stripe-webhook] PM detail fetch error:", e);
              }
            }

            await supabase
              .from("orders")
              .update({
                status: "paid",
                stripe_payment_intent_id: session.payment_intent,
                payment_method_brand: pmBrand,
                payment_method_last4: pmLast4,
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", orderRow.id);

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
                detail: `${quantity} ticket(s) issued`,
              },
            ]);
          }

          console.log(
            `[stripe-webhook] Issued ${quantity} tickets for event ${eventId}`,
          );
        } else if (metadata.type === "sneaky_access") {
          // ── Grant sneaky link access ─────────────────────
          const { error: accessError } = await supabase
            .from("sneaky_access")
            .upsert({
              session_id: metadata.session_id,
              user_id: metadata.user_id,
              amount_cents: 299,
              stripe_checkout_session_id: session.id,
              stripe_payment_intent_id: session.payment_intent,
            });

          if (accessError) {
            console.error("[stripe-webhook] Sneaky access error:", accessError);
            throw accessError;
          }
          // Create order for sneaky access purchase
          await supabase.from("orders").insert({
            user_id: metadata.user_id,
            type: "sneaky_access",
            status: "paid",
            subtotal_cents: 299,
            total_cents: 299,
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: session.payment_intent,
            paid_at: new Date().toISOString(),
          });

          console.log(
            `[stripe-webhook] Granted sneaky access for session ${metadata.session_id}`,
          );
        } else if (metadata.type === "ticket_upgrade") {
          // ── Upgrade existing ticket to a higher tier ──────
          const ticketId = metadata.ticket_id;
          const newTicketTypeId = metadata.new_ticket_type_id;
          const eventId = parseInt(metadata.event_id);
          const amountCents = session.amount_total || 0;

          // Fetch old ticket to capture the previous tier for quantity rollback
          const { data: oldTicket } = await supabase
            .from("tickets")
            .select("ticket_type_id, purchase_amount_cents")
            .eq("id", ticketId)
            .single();
          const oldTicketTypeId = oldTicket?.ticket_type_id;

          // Fetch the new ticket type to get full price
          const { data: newType } = await supabase
            .from("ticket_types")
            .select("price_cents")
            .eq("id", newTicketTypeId)
            .single();

          // Update the existing ticket: new type + cumulative amount + stay active
          const prevPaid = oldTicket?.purchase_amount_cents || 0;
          const { error: upgradeError } = await supabase
            .from("tickets")
            .update({
              ticket_type_id: newTicketTypeId,
              purchase_amount_cents: prevPaid + amountCents,
              stripe_checkout_session_id: session.id,
              stripe_payment_intent_id: session.payment_intent,
            })
            .eq("id", ticketId);

          if (upgradeError) {
            console.error(
              "[stripe-webhook] Ticket upgrade error:",
              upgradeError,
            );
            throw upgradeError;
          }

          // Void old wallet pass — tier has changed, the old pass shows stale tier info
          await voidWalletPass(supabase, ticketId);

          // Decrement quantity_sold on the OLD tier
          if (oldTicketTypeId && oldTicketTypeId !== newTicketTypeId) {
            const { data: oldTt } = await supabase
              .from("ticket_types")
              .select("quantity_sold")
              .eq("id", oldTicketTypeId)
              .single();
            await supabase
              .from("ticket_types")
              .update({
                quantity_sold: Math.max(0, (oldTt?.quantity_sold || 1) - 1),
              })
              .eq("id", oldTicketTypeId);
          }

          // Increment quantity_sold on the new tier
          const { data: tt } = await supabase
            .from("ticket_types")
            .select("quantity_sold")
            .eq("id", newTicketTypeId)
            .single();
          await supabase
            .from("ticket_types")
            .update({ quantity_sold: (tt?.quantity_sold || 0) + 1 })
            .eq("id", newTicketTypeId);

          console.log(
            `[stripe-webhook] Upgraded ticket ${ticketId}: ${oldTicketTypeId} → ${newTicketTypeId} for event ${eventId}`,
          );
        }
        break;
      }

      case "payment_intent.succeeded": {
        // Native PaymentSheet flow — PaymentIntent succeeded
        const pi = event.data.object;
        const piMetadata = pi.metadata || {};

        if (piMetadata.type === "cart_checkout") {
          await handleCartPaymentIntentSucceeded(supabase, pi);
        } else if (piMetadata.type === "event_ticket") {
          const piEventId = parseInt(piMetadata.event_id);
          const piTicketTypeId = piMetadata.ticket_type_id;
          const piUserId = piMetadata.user_id;
          const piQuantity = parseInt(piMetadata.quantity) || 1;

          // Check if tickets already issued (e.g. by checkout.session.completed)
          const { count: piExistingCount } = await supabase
            .from("tickets")
            .select("*", { count: "exact", head: true })
            .eq("stripe_payment_intent_id", pi.id);

          if ((piExistingCount || 0) > 0) {
            console.log(
              "[stripe-webhook] Tickets already issued for PI:",
              pi.id,
            );
            break;
          }

          // Issue tickets with HMAC-signed QR payloads
          const piTicketRows = [];
          for (let i = 0; i < piQuantity; i++) {
            const ticketUuid = crypto.randomUUID();
            const { qrToken, qrPayload } = await createSignedQrPayload(
              ticketUuid,
              piEventId,
            );
            piTicketRows.push({
              id: ticketUuid,
              event_id: piEventId,
              ticket_type_id: piTicketTypeId,
              user_id: piUserId,
              status: "active",
              qr_token: qrToken,
              qr_payload: qrPayload,
              stripe_payment_intent_id: pi.id,
              purchase_amount_cents: Math.round((pi.amount || 0) / piQuantity),
            });
          }

          const { error: piTicketError } = await supabase
            .from("tickets")
            .insert(piTicketRows);

          if (piTicketError) {
            console.error(
              "[stripe-webhook] PI ticket insert error:",
              piTicketError,
            );
            throw piTicketError;
          }

          // Increment quantity_sold
          const { data: piTt } = await supabase
            .from("ticket_types")
            .select("quantity_sold")
            .eq("id", piTicketTypeId)
            .single();
          await supabase
            .from("ticket_types")
            .update({ quantity_sold: (piTt?.quantity_sold || 0) + piQuantity })
            .eq("id", piTicketTypeId);

          // Convert ticket hold to completed
          await supabase
            .from("ticket_holds")
            .update({ status: "converted" })
            .eq("payment_intent_id", pi.id)
            .eq("status", "active");

          // Update order → paid + add timeline
          const { data: piOrderRow } = await supabase
            .from("orders")
            .select("id")
            .eq("stripe_payment_intent_id", pi.id)
            .single();

          if (piOrderRow) {
            let piPmBrand = null;
            let piPmLast4 = null;
            if (pi.latest_charge) {
              try {
                const piChargeRes = await fetch(
                  `https://api.stripe.com/v1/charges/${pi.latest_charge}`,
                  {
                    headers: {
                      Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY") || ""}`,
                    },
                  },
                );
                const piCharge = await piChargeRes.json();
                piPmBrand =
                  piCharge.payment_method_details?.card?.brand || null;
                piPmLast4 =
                  piCharge.payment_method_details?.card?.last4 || null;
              } catch (e) {
                console.error("[stripe-webhook] PM detail fetch error:", e);
              }
            }

            await supabase
              .from("orders")
              .update({
                status: "paid",
                payment_method_brand: piPmBrand,
                payment_method_last4: piPmLast4,
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", piOrderRow.id);

            await supabase.from("order_timeline").insert([
              {
                order_id: piOrderRow.id,
                type: "payment_authorized",
                label: "Payment authorized",
              },
              {
                order_id: piOrderRow.id,
                type: "payment_captured",
                label: "Payment captured",
                detail: `${piQuantity} ticket(s) issued`,
              },
            ]);
          }

          console.log(
            `[stripe-webhook] PI succeeded: issued ${piQuantity} tickets for event ${piEventId}`,
          );
        } else if (piMetadata.type === "ticket_upgrade") {
          // ── Upgrade existing ticket to a higher tier (PaymentSheet) ──
          const upTicketId = piMetadata.ticket_id;
          const upNewTypeId = piMetadata.new_ticket_type_id;
          const upEventId = parseInt(piMetadata.event_id);
          const upPaidCents = pi.amount || 0;

          const { data: upOldTicket } = await supabase
            .from("tickets")
            .select("ticket_type_id, purchase_amount_cents")
            .eq("id", upTicketId)
            .single();
          const upOldTypeId = upOldTicket?.ticket_type_id;

          const { data: upNewType } = await supabase
            .from("ticket_types")
            .select("price_cents, name")
            .eq("id", upNewTypeId)
            .single();

          const upPrevPaid = upOldTicket?.purchase_amount_cents || 0;

          const { error: upError } = await supabase
            .from("tickets")
            .update({
              ticket_type_id: upNewTypeId,
              purchase_amount_cents: upPrevPaid + upPaidCents,
              stripe_payment_intent_id: pi.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", upTicketId);

          if (upError) {
            console.error("[stripe-webhook] ticket_upgrade PI error:", upError);
            throw upError;
          }

          // Increment quantity_sold on the new tier, decrement on the old
          if (upNewTypeId) {
            const { data: ntRow } = await supabase
              .from("ticket_types")
              .select("quantity_sold")
              .eq("id", upNewTypeId)
              .single();
            await supabase
              .from("ticket_types")
              .update({ quantity_sold: (ntRow?.quantity_sold || 0) + 1 })
              .eq("id", upNewTypeId);
          }
          if (upOldTypeId) {
            const { data: otRow } = await supabase
              .from("ticket_types")
              .select("quantity_sold")
              .eq("id", upOldTypeId)
              .single();
            await supabase
              .from("ticket_types")
              .update({
                quantity_sold: Math.max(0, (otRow?.quantity_sold || 0) - 1),
              })
              .eq("id", upOldTypeId);
          }

          console.log(
            `[stripe-webhook] Ticket ${upTicketId} upgraded to type ${upNewTypeId} for event ${upEventId} via PI ${pi.id}`,
          );
        }
        break;
      }

      case "checkout.session.expired": {
        // Checkout Session expired without payment — release hold, fail order
        const expiredSession = event.data.object;

        await supabase
          .from("ticket_holds")
          .update({ status: "expired" })
          .eq("payment_intent_id", expiredSession.id)
          .eq("status", "active");

        await supabase
          .from("orders")
          .update({
            status: "payment_failed",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_checkout_session_id", expiredSession.id)
          .eq("status", "payment_pending");

        console.log(
          "[stripe-webhook] Checkout session expired, hold released:",
          expiredSession.id,
        );
        break;
      }

      case "payment_intent.payment_failed": {
        // Release hold on failed payment
        const failedPi = event.data.object;
        const failedMetadata = failedPi.metadata || {};

        if (failedMetadata.type === "cart_checkout" && failedMetadata.cart_id) {
          await supabase.rpc("cart_release_hold", {
            p_cart_id: failedMetadata.cart_id,
          });

          await supabase
            .from("orders")
            .update({
              status: "payment_failed",
              updated_at: new Date().toISOString(),
            })
            .eq("cart_id", failedMetadata.cart_id)
            .eq("status", "payment_pending");

          console.log(
            "[stripe-webhook] Cart payment failed, hold released:",
            failedMetadata.cart_id,
          );
          break;
        }

        await supabase
          .from("ticket_holds")
          .update({ status: "expired" })
          .eq("payment_intent_id", failedPi.id)
          .eq("status", "active");

        // Update order status
        await supabase
          .from("orders")
          .update({
            status: "payment_failed",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_payment_intent_id", failedPi.id)
          .eq("status", "payment_pending");

        console.log(
          "[stripe-webhook] Payment failed, hold released for PI:",
          failedPi.id,
        );
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntent = charge.payment_intent;
        const refundObjects = Array.isArray(charge.refunds?.data)
          ? charge.refunds.data
          : [];
        const refundedLineItemIds = Array.from(
          new Set(
            refundObjects
              .map(
                (refund: any) =>
                  refund?.metadata?.cart_line_item_id ||
                  refund?.metadata?.line_item_id,
              )
              .filter(Boolean),
          ),
        );
        const stripeRefundIds = refundObjects
          .map((refund: any) => refund?.id)
          .filter(Boolean);

        if (paymentIntent) {
          let toRefund: any[] = [];

          if (refundedLineItemIds.length > 0) {
            for (const refund of refundObjects) {
              const lineItemId =
                refund?.metadata?.cart_line_item_id ||
                refund?.metadata?.line_item_id;
              const cartId = refund?.metadata?.cart_id;
              if (!lineItemId || !cartId || !refund?.amount || !refund?.id) {
                continue;
              }

              const { data: applied, error: applyError } = await supabase.rpc(
                "cart_apply_line_refund",
                {
                  p_cart_id: cartId,
                  p_line_item_id: lineItemId,
                  p_stripe_refund_id: refund.id,
                  p_amount_cents: refund.amount,
                  p_idempotency_key: `cart_line_refund_${lineItemId}_${refund.amount}`,
                },
              );
              if (applyError) {
                console.error(
                  "[stripe-webhook] Cart line refund sync error:",
                  applyError,
                );
                continue;
              }
              if (Array.isArray(applied?.ticketRows)) {
                toRefund = toRefund.concat(applied.ticketRows);
              }
            }
          } else {
            // Pull tickets BEFORE flipping them so we keep event_id +
            // ticket_type_id to decrement inventory and notify waitlisters.
            const { data: legacyToRefund } = await supabase
              .from("tickets")
              .select("id, event_id, ticket_type_id")
              .eq("stripe_payment_intent_id", paymentIntent)
              .eq("status", "active");
            toRefund = legacyToRefund || [];

            const { error: refundError } = await supabase
              .from("tickets")
              .update({ status: "refunded" })
              .eq("stripe_payment_intent_id", paymentIntent)
              .eq("status", "active");

            if (refundError) {
              console.error(
                "[stripe-webhook] Refund update error:",
                refundError,
              );
            }
          }

          // Tally refunds per tier + decrement quantity_sold so the
          // freed seats show as available. Then fire one waitlist
          // promotion per freed seat.
          if (toRefund && toRefund.length > 0) {
            const perTier = new Map<string, number>();
            for (const t of toRefund) {
              const key = String(t.ticket_type_id);
              perTier.set(key, (perTier.get(key) ?? 0) + 1);
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

          // Tally refunds per tier + decrement quantity_sold so the
          // freed seats show as available. Then fire one waitlist
          // promotion per freed seat.
          if (toRefund && toRefund.length > 0) {
            const perTier = new Map<string, number>();
            for (const t of toRefund) {
              const key = String(t.ticket_type_id);
              perTier.set(key, (perTier.get(key) ?? 0) + 1);
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

          // Void wallet passes for refunded tickets
          let refundedTicketsQuery = supabase
            .from("tickets")
            .select("id")
            .eq("stripe_payment_intent_id", paymentIntent)
            .eq("status", "refunded");
          if (refundedLineItemIds.length > 0) {
            refundedTicketsQuery = refundedTicketsQuery.in(
              "cart_line_item_id",
              refundedLineItemIds,
            );
          }
          const { data: refundedTickets } = await refundedTicketsQuery;
          if (refundedTickets) {
            for (const t of refundedTickets) {
              await voidWalletPass(supabase, t.id);
            }
          }

          // Update order status + add timeline
          const { data: refundedOrder } = await supabase
            .from("orders")
            .select("id")
            .eq("stripe_payment_intent_id", paymentIntent)
            .single();

          if (refundedOrder) {
            const isFullRefund = charge.amount_refunded >= charge.amount;
            await supabase
              .from("orders")
              .update({
                status: isFullRefund ? "refunded" : "partially_refunded",
                refunded_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", refundedOrder.id);

            await supabase.from("order_timeline").insert({
              order_id: refundedOrder.id,
              type: "refund_processed",
              label: isFullRefund
                ? "Full refund processed"
                : "Partial refund processed",
              detail: `$${(charge.amount_refunded / 100).toFixed(2)} refunded`,
            });

            // Update any pending refund requests to processed
            await supabase
              .from("refund_requests")
              .update({
                status: "processed",
                resolved_at: new Date().toISOString(),
              })
              .eq("order_id", refundedOrder.id)
              .eq("status", "pending");
          }

          console.log(
            "[stripe-webhook] Refunded tickets for PI:",
            paymentIntent,
          );
        }
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object;
        const paymentIntent = dispute.payment_intent;

        if (paymentIntent) {
          // Find the event via ticket
          const { data: ticket } = await supabase
            .from("tickets")
            .select("event_id")
            .eq("stripe_payment_intent_id", paymentIntent)
            .limit(1)
            .single();

          if (ticket?.event_id) {
            await supabase
              .from("events")
              .update({ payout_status: "on_hold" })
              .eq("id", ticket.event_id);

            // Update order status + add timeline
            const { data: disputedOrder } = await supabase
              .from("orders")
              .select("id")
              .eq("stripe_payment_intent_id", paymentIntent)
              .single();

            if (disputedOrder) {
              await supabase
                .from("orders")
                .update({
                  status: "disputed",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", disputedOrder.id);

              await supabase.from("order_timeline").insert({
                order_id: disputedOrder.id,
                type: "dispute_opened",
                label: "Dispute opened",
                detail: `Reason: ${dispute.reason || "unknown"}`,
              });
            }

            // Notify host + co-hosts
            await notifyEventOrganizers(supabase, ticket.event_id, {
              type: "event_update",
              title: "Dispute opened",
              body: "A buyer has disputed a charge for your event. Payouts are on hold until resolved.",
              data: {
                entityType: "event",
                entityId: ticket.event_id,
                disputeId: dispute.id,
                disputeReason: dispute.reason,
              },
            });

            console.log(
              "[stripe-webhook] Event payout on_hold due to dispute:",
              ticket.event_id,
            );
          }
        }
        break;
      }

      case "account.updated": {
        const account = event.data.object;
        const { error: accountError } = await supabase
          .from("organizer_accounts")
          .update({
            charges_enabled: account.charges_enabled,
            payouts_enabled: account.payouts_enabled,
            details_submitted: account.details_submitted,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_account_id", account.id);

        if (accountError) {
          console.error("[stripe-webhook] Account update error:", accountError);
        }
        break;
      }

      // ── Sneaky Lynk Subscription Lifecycle ────────────────
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const subMeta = sub.metadata || {};
        const hostId = subMeta.dvnt_user_id;
        const planId = subMeta.plan_id;
        const planKey = subMeta.plan_key;
        const productFamily = subMeta.product_family;

        // DVNT Membership / new Sneaky tiers carry `plan_key` (vs the legacy
        // `plan_id`) → reconcile into membership_subscriptions.
        if (hostId && planKey) {
          const memPriceId = sub.items?.data?.[0]?.price?.id || null;
          const customerId =
            typeof sub.customer === "string"
              ? sub.customer
              : sub.customer?.id || null;
          // Monotonic upsert via RPC — refuses to overwrite a row whose
          // `last_event_at` is already newer than this event. Closes the
          // I5 race where a late/replayed canceled lands after active.
          const { data: memApplied, error: memErr } = await supabase.rpc(
            "upsert_membership_subscription",
            {
              p_user_id: hostId,
              p_rail: "web_stripe",
              p_product_family: productFamily || "dvnt_membership",
              p_plan_key: planKey,
              p_status: sub.status,
              p_provider_ref: sub.id,
              p_stripe_customer_id: customerId,
              p_stripe_subscription_id: sub.id,
              p_stripe_price_id: memPriceId,
              p_current_period_start: sub.current_period_start
                ? new Date(sub.current_period_start * 1000).toISOString()
                : null,
              p_current_period_end: sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : null,
              p_cancel_at_period_end: sub.cancel_at_period_end || false,
              p_canceled_at: sub.canceled_at
                ? new Date(sub.canceled_at * 1000).toISOString()
                : null,
              p_event_created_at: new Date(event.created * 1000).toISOString(),
            },
          );
          if (memErr) {
            console.error("[stripe-webhook] membership upsert error:", memErr);
            throw memErr;
          }
          if (memApplied === false) {
            console.log(
              `[stripe-webhook] stale event skipped for ${hostId} (event.created=${event.created})`,
            );
          }
          // Audit + idempotency (unique on stripe_event_id).
          await supabase.from("membership_subscription_events").upsert(
            {
              stripe_event_id: event.id,
              user_id: hostId,
              stripe_subscription_id: sub.id,
              kind: event.type,
              to_plan_key: planKey,
            },
            { onConflict: "stripe_event_id" },
          );
          console.log(
            `[stripe-webhook] Membership ${event.type} for ${hostId}: ${planKey} ${sub.status}`,
          );
          break;
        }

        if (!hostId || !planId) {
          console.warn(
            "[stripe-webhook] Subscription missing metadata:",
            sub.id,
          );
          break;
        }

        const stripePriceId = sub.items?.data?.[0]?.price?.id || null;

        const { error: subError } = await supabase
          .from("sneaky_subscriptions")
          .upsert(
            {
              host_id: hostId,
              plan_id: planId,
              status: sub.status,
              stripe_subscription_id: sub.id,
              stripe_price_id: stripePriceId,
              current_period_start: sub.current_period_start
                ? new Date(sub.current_period_start * 1000).toISOString()
                : null,
              current_period_end: sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : null,
              cancel_at_period_end: sub.cancel_at_period_end || false,
              canceled_at: sub.canceled_at
                ? new Date(sub.canceled_at * 1000).toISOString()
                : null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "host_id" },
          );

        if (subError) {
          console.error(
            "[stripe-webhook] Subscription upsert error:",
            subError,
          );
          throw subError;
        }

        // Mark corresponding order as paid if subscription is active/trialing
        if (["active", "trialing"].includes(sub.status)) {
          const { data: subOrder } = await supabase
            .from("orders")
            .select("id")
            .eq("user_id", hostId)
            .eq("type", "sneaky_subscription")
            .eq("status", "payment_pending")
            .filter("stripe_checkout_session_id", "not.is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (subOrder) {
            await supabase
              .from("orders")
              .update({
                status: "paid",
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", subOrder.id);
          }
        }

        console.log(
          `[stripe-webhook] Subscription ${event.type} for host ${hostId}: ${sub.status}`,
        );
        break;
      }

      case "customer.subscription.deleted": {
        const canceledSub = event.data.object;
        const cancelMeta = canceledSub.metadata || {};
        const cancelHostId = cancelMeta.dvnt_user_id;

        // Update whichever table holds this subscription id (no-op on the other).
        await supabase
          .from("sneaky_subscriptions")
          .update({
            status: "canceled",
            canceled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", canceledSub.id);
        await supabase
          .from("membership_subscriptions")
          .update({
            status: "canceled",
            canceled_at: new Date().toISOString(),
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", canceledSub.id);

        if (cancelHostId) {
          console.log(
            `[stripe-webhook] Subscription canceled for host ${cancelHostId}`,
          );
        }
        break;
      }

      case "invoice.payment_failed": {
        const failedInvoice = event.data.object;
        const subId = failedInvoice.subscription;

        if (subId) {
          // Set 7-day grace period on first failure
          const gracePeriodEndsAt = new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString();

          await supabase
            .from("sneaky_subscriptions")
            .update({
              status: "past_due",
              grace_period_ends_at: gracePeriodEndsAt,
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", subId)
            .is("grace_period_ends_at", null); // Only set on first failure

          // If grace_period_ends_at was already set, just update status
          await supabase
            .from("sneaky_subscriptions")
            .update({
              status: "past_due",
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", subId)
            .not("grace_period_ends_at", "is", null);

          // Same grace handling for DVNT membership subscriptions.
          await supabase
            .from("membership_subscriptions")
            .update({
              status: "past_due",
              grace_period_ends_at: gracePeriodEndsAt,
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", subId)
            .is("grace_period_ends_at", null);
          await supabase
            .from("membership_subscriptions")
            .update({
              status: "past_due",
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", subId)
            .not("grace_period_ends_at", "is", null);

          console.log(
            `[stripe-webhook] Invoice payment failed for subscription ${subId} (grace until ${gracePeriodEndsAt})`,
          );
        }
        break;
      }

      // ── Phase 2: New webhook events ─────────────────────────

      case "charge.dispute.closed": {
        const closedDispute = event.data.object;
        const closedPi = closedDispute.payment_intent;
        const disputeStatus = closedDispute.status; // won, lost, warning_closed

        if (closedPi) {
          // Find the order
          const { data: disputeOrder } = await supabase
            .from("orders")
            .select("id")
            .eq("stripe_payment_intent_id", closedPi)
            .single();

          if (disputeOrder) {
            if (disputeStatus === "won") {
              // Merchant won — restore order to paid, add timeline
              await supabase
                .from("orders")
                .update({
                  status: "paid",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", disputeOrder.id);

              await supabase.from("order_timeline").insert({
                order_id: disputeOrder.id,
                type: "dispute_won",
                label: "Dispute resolved in your favor",
                detail: `Dispute ${closedDispute.id} closed as won`,
              });
            } else if (disputeStatus === "lost") {
              // Merchant lost — mark refunded, add timeline
              await supabase
                .from("orders")
                .update({
                  status: "refunded",
                  refunded_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", disputeOrder.id);

              // Revoke tickets for lost disputes
              const { data: disputeRevokedTickets } = await supabase
                .from("tickets")
                .update({ status: "refunded" })
                .eq("stripe_payment_intent_id", closedPi)
                .eq("status", "active")
                .select("id");
              // Void wallet passes for revoked tickets
              if (disputeRevokedTickets) {
                for (const t of disputeRevokedTickets) {
                  await voidWalletPass(supabase, t.id);
                }
              }

              await supabase.from("order_timeline").insert({
                order_id: disputeOrder.id,
                type: "dispute_lost",
                label: "Dispute lost — funds returned to buyer",
                detail: `Dispute ${closedDispute.id} closed as lost`,
              });
            } else {
              // warning_closed or other
              await supabase.from("order_timeline").insert({
                order_id: disputeOrder.id,
                type: "dispute_closed",
                label: "Dispute closed",
                detail: `Status: ${disputeStatus}`,
              });
            }
          }

          // Check if payout hold can be released (no more active disputes for this event)
          const { data: disputeTicket } = await supabase
            .from("tickets")
            .select("event_id")
            .eq("stripe_payment_intent_id", closedPi)
            .limit(1)
            .single();

          if (disputeTicket?.event_id) {
            // Check for any remaining disputed orders for this event
            // Step 1: Get all payment_intent IDs for this event's tickets
            const { data: eventTicketPIs } = await supabase
              .from("tickets")
              .select("stripe_payment_intent_id")
              .eq("event_id", disputeTicket.event_id)
              .not("stripe_payment_intent_id", "is", null);

            const piIds = (eventTicketPIs || [])
              .map((t: any) => t.stripe_payment_intent_id)
              .filter(Boolean);

            // Step 2: Count disputed orders matching those PIs
            let activeDisputeCount = 0;
            if (piIds.length > 0) {
              const { count } = await supabase
                .from("orders")
                .select("id", { count: "exact", head: true })
                .eq("status", "disputed")
                .in("stripe_payment_intent_id", piIds);
              activeDisputeCount = count || 0;
            }

            if (activeDisputeCount === 0) {
              // No more active disputes — release hold
              const { data: heldEvent } = await supabase
                .from("events")
                .select("payout_status")
                .eq("id", disputeTicket.event_id)
                .single();

              if (heldEvent?.payout_status === "on_hold") {
                await supabase
                  .from("events")
                  .update({ payout_status: "pending" })
                  .eq("id", disputeTicket.event_id);

                console.log(
                  `[stripe-webhook] Payout hold released for event ${disputeTicket.event_id}`,
                );
              }
            }

            // Notify host + co-hosts
            await notifyEventOrganizers(supabase, disputeTicket.event_id, {
              type: "event_update",
              title:
                disputeStatus === "won"
                  ? "Dispute resolved in your favor"
                  : disputeStatus === "lost"
                    ? "Dispute lost — funds returned to buyer"
                    : "Dispute closed",
              body: `A dispute for your event has been resolved (${disputeStatus}).`,
              data: {
                entityType: "event",
                entityId: disputeTicket.event_id,
                disputeId: closedDispute.id,
                disputeStatus,
              },
            });
          }
        }

        console.log(
          `[stripe-webhook] Dispute closed: ${closedDispute.id} (${disputeStatus})`,
        );
        break;
      }

      case "invoice.paid": {
        const paidInvoice = event.data.object;
        const paidSubId = paidInvoice.subscription;

        if (paidSubId) {
          // Confirm subscription is active on renewal + clear grace period
          await supabase
            .from("sneaky_subscriptions")
            .update({
              status: "active",
              grace_period_ends_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", paidSubId)
            .in("status", ["past_due", "active", "trialing"]);

          console.log(
            `[stripe-webhook] Invoice paid for subscription ${paidSubId} — grace period cleared`,
          );
        }
        break;
      }

      case "transfer.reversed": {
        const transfer = event.data.object;
        const transferMeta = transfer.metadata || {};
        const transferEventId = transferMeta.event_id
          ? parseInt(transferMeta.event_id)
          : null;

        if (transferEventId) {
          // Put payout back on hold
          await supabase
            .from("events")
            .update({
              payout_status: "on_hold",
              updated_at: new Date().toISOString(),
            })
            .eq("id", transferEventId);

          // Update payout record
          await supabase
            .from("payouts")
            .update({
              status: "reversed",
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_payout_id", transfer.id);

          // Notify host + co-hosts
          await notifyEventOrganizers(supabase, transferEventId, {
            type: "event_update",
            title: "Payout reversed",
            body: "A payout transfer for your event has been reversed. Please check your dashboard.",
            data: {
              entityType: "event",
              entityId: transferEventId,
              transferId: transfer.id,
            },
          });

          console.log(
            `[stripe-webhook] Transfer reversed for event ${transferEventId}: ${transfer.id}`,
          );
        } else {
          console.warn(
            `[stripe-webhook] Transfer reversed without event_id metadata: ${transfer.id}`,
          );
        }
        break;
      }

      case "payout.failed": {
        const failedPayout = event.data.object;
        const failedPayoutAccount = failedPayout.destination || event.account;

        if (failedPayoutAccount) {
          // Find organizer by Stripe account ID
          const { data: orgAccount } = await supabase
            .from("organizer_accounts")
            .select("host_id")
            .eq("stripe_account_id", failedPayoutAccount)
            .single();

          if (orgAccount?.host_id) {
            // Find events with pending/released payouts for this host
            const { data: affectedEvents } = await supabase
              .from("events")
              .select("id, title")
              .eq("host_id", orgAccount.host_id)
              .eq("payout_status", "released")
              .limit(10);

            for (const evt of affectedEvents || []) {
              await notifyEventOrganizers(supabase, evt.id, {
                type: "event_update",
                title: "Payout failed",
                body: `The bank payout for "${evt.title}" failed. Please update your bank account details.`,
                data: {
                  entityType: "event",
                  entityId: evt.id,
                  payoutId: failedPayout.id,
                  failureCode: failedPayout.failure_code,
                },
              });
            }

            console.log(
              `[stripe-webhook] Payout failed for account ${failedPayoutAccount}: ${failedPayout.failure_code || "unknown"}`,
            );
          }
        }
        break;
      }

      case "radar.early_fraud_warning.created": {
        const warning = event.data.object;
        const warningPi = warning.payment_intent;

        if (warningPi) {
          // Find order by payment intent
          const { data: flaggedOrder } = await supabase
            .from("orders")
            .select("id")
            .eq("stripe_payment_intent_id", warningPi)
            .single();

          if (flaggedOrder) {
            // Add timeline entry
            await supabase.from("order_timeline").insert({
              order_id: flaggedOrder.id,
              type: "fraud_warning",
              label: "Early fraud warning",
              detail: `Stripe Radar flagged this payment (${warning.fraud_type || "unknown"})`,
            });
          }

          // Find event via ticket and notify organizers
          const { data: warningTicket } = await supabase
            .from("tickets")
            .select("event_id")
            .eq("stripe_payment_intent_id", warningPi)
            .limit(1)
            .single();

          if (warningTicket?.event_id) {
            await notifyEventOrganizers(supabase, warningTicket.event_id, {
              type: "event_update",
              title: "Fraud warning",
              body: "Stripe Radar flagged a suspicious payment for your event. Review your dashboard.",
              data: {
                entityType: "event",
                entityId: warningTicket.event_id,
                warningId: warning.id,
                fraudType: warning.fraud_type,
              },
            });
          }

          console.log(
            `[stripe-webhook] Radar fraud warning for PI ${warningPi}: ${warning.fraud_type}`,
          );
        }
        break;
      }
    }
  } catch (err) {
    console.error("[stripe-webhook] Processing error:", err);
    return new Response(JSON.stringify({ error: "Processing failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
