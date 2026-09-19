/**
 * Canonical guest ticket-email delivery (WS email contract).
 *
 * ONE order → ONE email containing EVERY valid issued ticket, built from
 * the authoritative order ↔ ticket link (tickets.order_id, falling back
 * to the legacy Stripe links for pre-migration rows). Never from the
 * browser's quantity, never from "tickets this call happened to insert"
 * — a partial-replay edge used to email only the rows inserted on that
 * attempt.
 *
 * Delivery state is persisted on orders.ticket_email_* and is INDEPENDENT
 * of ticket issuance: this module never inserts a ticket, creates an
 * order, or touches Stripe. An email retry is an email retry.
 *
 * `deliverTicketBundleEmail` never throws — email failure must not roll
 * back a paid, fulfilled order. It returns { ok } and records the
 * outcome on the order + order_timeline.
 */

import { sendResendEmail, ticketConfirmation } from "./send-resend-email.ts";

const SITE_URL =
  (Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live").replace(
    /\/$/,
    "",
  );

export interface OrderTicketBundle {
  order: {
    id: string;
    event_id: number;
    guest_email: string | null;
    quantity: number;
    total_cents: number | null;
    currency: string | null;
    status: string;
    ticket_email_status: string | null;
  };
  event: {
    title: string | null;
    start_date: string | null;
    location_name: string | null;
    location_address: string | null;
    flyer_image_url: string | null;
    dominant_color: string | null;
  } | null;
  tickets: {
    id: string;
    qr_token: string;
    guest_lookup_token: string | null;
    guest_name: string | null;
    attendee_name: string | null;
    status: string;
    tier: string | null;
    tierLabel: string | null;
  }[];
}

/**
 * Load the authoritative bundle for an order: exactly the valid issued
 * tickets linked to THIS order — deduped, no other order's tickets, no
 * refunded/void rows. Legacy rows without order_id fall back to the
 * Stripe links recorded on the order.
 */
export async function loadOrderTicketBundle(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orderId: string,
): Promise<OrderTicketBundle | null> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, event_id, guest_email, quantity, total_cents, currency, status, " +
        "ticket_email_status, stripe_payment_intent_id, stripe_checkout_session_id",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order) return null;

  const select =
    "id, qr_token, guest_lookup_token, guest_name, attendee_name, status, " +
    "ticket_type:ticket_types(name, category)";

  // deno-lint-ignore no-explicit-any
  let rows: any[] = [];
  const { data: byOrder, error: linkError } = await supabase
    .from("tickets")
    .select(select)
    .eq("order_id", orderId)
    .order("order_index", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (linkError) throw linkError;
  rows = byOrder ?? [];

  // Legacy fallback for rows minted before tickets.order_id existed.
  if (rows.length === 0) {
    if (order.stripe_payment_intent_id) {
      const { data } = await supabase
        .from("tickets")
        .select(select)
        .eq("stripe_payment_intent_id", order.stripe_payment_intent_id)
        .order("order_index", { ascending: true, nullsFirst: false });
      rows = data ?? [];
    }
    if (rows.length === 0 && order.stripe_checkout_session_id) {
      const { data } = await supabase
        .from("tickets")
        .select(select)
        .eq("stripe_checkout_session_id", order.stripe_checkout_session_id)
        .order("order_index", { ascending: true, nullsFirst: false });
      rows = data ?? [];
    }
  }

  const { data: event } = await supabase
    .from("events")
    .select(
      "title, start_date, location_name, location_address, flyer_image_url, dominant_color",
    )
    .eq("id", order.event_id)
    .maybeSingle();

  const seen = new Set<string>();
  const tickets = [];
  for (const row of rows) {
    // Refunded/void tickets are not deliverable credentials — a partially
    // refunded order resends only the tickets that still admit someone.
    if (row.status === "refunded" || row.status === "void") continue;
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const tt = Array.isArray(row.ticket_type)
      ? row.ticket_type[0]
      : row.ticket_type;
    tickets.push({
      id,
      qr_token: row.qr_token,
      guest_lookup_token: row.guest_lookup_token ?? null,
      guest_name: row.guest_name ?? null,
      attendee_name: row.attendee_name ?? null,
      status: row.status,
      tier: tt?.category ?? null,
      tierLabel: tt?.name ?? null,
    });
  }

  return { order, event, tickets };
}

function fmtDateLine(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Send (or re-send) the order's ticket bundle email and persist the
 * outcome. Options:
 *   force:      manual "Resend tickets" — sends even after a successful
 *               delivery. Automatic paths leave this false so a webhook
 *               replay can't spam the guest.
 *   kind:       'fulfillment' | 'manual_resend' | 'retry' — recorded on
 *               the timeline so audit can tell them apart.
 */
export async function deliverTicketBundleEmail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orderId: string,
  opts: {
    force?: boolean;
    kind?: "fulfillment" | "manual_resend" | "retry";
    logPrefix?: string;
  } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const logPrefix = opts.logPrefix ?? "[ticket-email]";
  const kind = opts.kind ?? "fulfillment";

  const bundle = await loadOrderTicketBundle(supabase, orderId);
  if (!bundle) {
    console.error(`${logPrefix} no order ${orderId} — cannot deliver`);
    return { ok: false, reason: "order_not_found" };
  }
  const { order, event, tickets } = bundle;

  if (order.ticket_email_status === "sent" && !opts.force) {
    return { ok: true, reason: "already_sent" };
  }
  if (order.status !== "paid") {
    return { ok: false, reason: "order_not_paid" };
  }
  if (!order.guest_email) {
    return { ok: false, reason: "no_recipient" };
  }
  if (tickets.length === 0) {
    // A paid order with zero valid tickets is a fulfillment problem, not
    // an email problem — mark it failed so the sweep keeps surfacing it
    // instead of emailing an empty bundle.
    await supabase
      .from("orders")
      .update({
        ticket_email_status: "failed",
        ticket_email_last_error: "no_valid_tickets",
        ticket_email_last_attempt_at: new Date().toISOString(),
      })
      .eq("id", orderId);
    return { ok: false, reason: "no_valid_tickets" };
  }

  const nowIso = new Date().toISOString();
  await supabase
    .from("orders")
    .update({
      ticket_email_status: "pending",
      ticket_email_attempts: (await bumpAttempts(supabase, orderId)) ?? 1,
      ticket_email_last_attempt_at: nowIso,
    })
    .eq("id", orderId);

  const to = order.guest_email;
  const guestName = tickets[0]?.guest_name ?? null;
  const greeting = `${guestName ? `Hey ${guestName}, ` : ""}Show ${
    tickets.length > 1 ? "these QR codes" : "this QR code"
  } at the door. We've attached your purchase to ${to} — keep this email handy.`;

  try {
    const messageId = await sendResendEmail({
      to,
      ...ticketConfirmation({
        eventTitle: event?.title || "your event",
        dateLine: fmtDateLine(event?.start_date),
        location: event?.location_name || event?.location_address || null,
        flyerUrl: event?.flyer_image_url ?? null,
        dominantColor: event?.dominant_color ?? null,
        greeting,
        toEmail: to,
        summary: [
          { label: "Order", value: `#${order.id.slice(0, 8).toUpperCase()}` },
          {
            label: "Tickets",
            value: String(tickets.length),
          },
          ...(order.total_cents != null
            ? [{
                label: "Paid",
                value: `$${(order.total_cents / 100).toFixed(2)} ${
                  (order.currency || "usd").toUpperCase()
                }`,
                strong: true,
              }]
            : []),
        ],
        tickets: tickets.map((t) => ({
          tier: t.tier ?? "ga",
          tierLabel: t.tierLabel ?? null,
          qrToken: t.qr_token,
          lookupUrl: t.guest_lookup_token
            ? `${SITE_URL}/public/tickets/guest/${t.guest_lookup_token}`
            : null,
          note: t.attendee_name ? `Ticket for ${t.attendee_name}` : null,
        })),
      }),
    });

    await supabase
      .from("orders")
      .update({
        ticket_email_status: "sent",
        ticket_email_sent_at: new Date().toISOString(),
        ticket_email_resend_id: messageId,
        ticket_email_last_error: null,
      })
      .eq("id", orderId);
    await supabase.from("order_timeline").insert({
      order_id: orderId,
      type: kind === "manual_resend" ? "ticket_email_resent" : "ticket_email_sent",
      label: kind === "manual_resend"
        ? "Tickets re-sent to guest"
        : `Tickets emailed to ${maskEmail(to)}`,
      detail: `${tickets.length} ticket(s) in one email${
        messageId ? ` (Resend ${messageId})` : ""
      }`,
    });
    console.log(
      `${logPrefix} ${kind} ticket email → ${maskEmail(to)} (${tickets.length} tickets, id ${messageId})`,
    );
    return { ok: true };
  } catch (sendErr) {
    const msg = String((sendErr as Error)?.message ?? sendErr).slice(0, 300);
    await supabase
      .from("orders")
      .update({
        ticket_email_status: "failed",
        ticket_email_last_error: msg,
      })
      .eq("id", orderId);
    await supabase.from("order_timeline").insert({
      order_id: orderId,
      type: "ticket_email_failed",
      label: "Ticket email failed — will retry",
      detail: msg,
    });
    console.error(`${logPrefix} ticket email failed for order ${orderId}:`, msg);
    return { ok: false, reason: "send_failed" };
  }
}

async function bumpAttempts(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orderId: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("orders")
    .select("ticket_email_attempts")
    .eq("id", orderId)
    .maybeSingle();
  return (data?.ticket_email_attempts ?? 0) + 1;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 1) || "*";
  return `${head}***@${domain}`;
}
