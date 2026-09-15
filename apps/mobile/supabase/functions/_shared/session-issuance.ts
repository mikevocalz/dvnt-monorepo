/**
 * Checkout-Session-rail ticket issuance (guest + authed hosted checkout),
 * shared between the Stripe webhook (checkout.session.completed /
 * checkout.session.async_payment_succeeded, metadata.type === "event_ticket")
 * and the reconcile-orders sweep. Extracted from stripe-webhook/index.ts.
 *
 * Idempotent on replay: the tickets upsert ignores duplicates on the
 * (stripe_checkout_session_id, order_index) partial unique index
 * (migration 20260915190000), so a second call inserts 0 rows and skips
 * the side effects (quantity_sold, capacity alerts, promo, guest email)
 * while still repairing order money-state + timeline.
 */

import { createSignedQrPayload } from "./hmac-qr.ts";
import { maybeFireCapacityAlerts } from "./capacity-alerts.ts";
import { incrementPromoUsage } from "./apply-promo-code.ts";
import {
  sendResendEmail,
  ticketConfirmation,
} from "./send-resend-email.ts";
import {
  recordPromoterEarning,
  upsertOrderMoneyState,
} from "./order-state.ts";

const SITE_URL =
  (Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live").replace(
    /\/$/,
    "",
  );

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
    logPrefix?: string;
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
      `${opts.logPrefix ?? "[stripe-webhook]"} guest ticket email sent to ${to} (id ${messageId})`,
    );
  }
}

export interface SessionIssuanceResult {
  issued: number; // rows actually inserted this call
  alreadyIssued: boolean; // true when 0 inserted because they existed
  orderId: string | null;
}

export async function issueTicketsForCheckoutSession(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  session: any, // Stripe Checkout Session object, unexpanded (payment_intent is a string id)
  opts: { eventCreatedAt: string; logPrefix: string },
): Promise<SessionIssuanceResult> {
  const { eventCreatedAt, logPrefix } = opts;
  const metadata = session.metadata || {};

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

  // Idempotent insert: the partial unique index on
  // (stripe_checkout_session_id, order_index) makes a webhook retry or a
  // reconcile-sweep replay insert 0 rows instead of double-issuing.
  const { data: insertedTickets, error: ticketError } = await supabase
    .from("tickets")
    .upsert(ticketRows, {
      onConflict: "stripe_checkout_session_id,order_index",
      ignoreDuplicates: true,
    })
    .select("id, qr_token, guest_lookup_token");

  // Convert inventory hold to prevent double-counting
  await supabase
    .from("ticket_holds")
    .update({ status: "converted" })
    .eq("payment_intent_id", session.id)
    .eq("status", "active");

  if (ticketError) {
    console.error(`${logPrefix} Ticket insert error:`, ticketError);
    throw ticketError;
  }

  const issued = insertedTickets?.length ?? 0;

  if (issued > 0) {
    // Increment quantity_sold — only by rows actually inserted this call.
    const { error: incError } = await supabase.rpc("increment_counter", {
      table_name: "ticket_types",
      column_name: "quantity_sold",
      row_id: ticketTypeId,
      amount: issued,
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
        .update({ quantity_sold: (tt?.quantity_sold || 0) + issued })
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
    if (isGuestPurchase && insertedTickets && insertedTickets.length > 0) {
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
            logPrefix,
          },
        );
      } catch (mailErr) {
        // Email failure should not roll back the ticket — log and move on.
        console.error(`${logPrefix} guest email send failed:`, mailErr);
      }
    }
  }

  // ── Update order → paid + add timeline ────────
  // Runs even when issued === 0 (replay): the money-state RPC is
  // monotonic and repairs an order left payment_pending by a crashed
  // first attempt.
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
                Authorization:
                  `Bearer ${Deno.env.get("STRIPE_SECRET_KEY") || ""}`,
              },
            },
          );
          const charge = await chargeRes.json();
          pmBrand = charge.payment_method_details?.card?.brand || null;
          pmLast4 = charge.payment_method_details?.card?.last4 || null;
        }
      } catch (e) {
        console.error(`${logPrefix} PM detail fetch error:`, e);
      }
    }

    // Guarded money-state write (monotonic on event.created) —
    // a stale replay can never flip a newer state back.
    await upsertOrderMoneyState(supabase, {
      orderId: orderRow.id,
      status: "paid",
      eventCreatedAt,
      stripePaymentIntentId: session.payment_intent ?? null,
      paymentMethodBrand: pmBrand,
      paymentMethodLast4: pmLast4,
      paidAt: new Date().toISOString(),
    });

    // Replay (issued === 0): repair money-state but don't add a second
    // payment_authorized/payment_captured pair to the timeline.
    if (issued > 0) {
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
          detail: `${issued} ticket(s) issued`,
        },
      ]);
    }

    // Promoter attribution + rev-share earning (WS-4) —
    // idempotent on replay (attribution keyed on order_id,
    // ledger on (order_id, entry_type)).
    await recordPromoterEarning(
      supabase,
      orderRow.id,
      metadata.dvnt_promoter_code || null,
    );
  }

  console.log(
    `${logPrefix} Issued ${issued} tickets for event ${eventId}`,
  );

  return {
    issued,
    alreadyIssued: issued === 0,
    orderId: orderRow?.id ?? null,
  };
}
