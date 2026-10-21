/**
 * Safe replay of a completed zero-dollar online ticket checkout.
 *
 * An idempotency key deduplicates an operation; it is not authorization to
 * read arbitrary orders or proof that payment/issuance completed. Both the
 * initial retry and the unique-key race recovery must use this same check.
 */
export interface CheckoutReplayRequest {
  idempotencyKey: string;
  eventId: number;
  ticketTypeId: string;
  quantity: number;
  userId: string | null;
  guestEmail: string | null;
}

export const CHECKOUT_REPLAY_UNAVAILABLE = {
  code: "checkout_replay_unavailable",
  error: "This checkout attempt cannot be replayed. Check your tickets before trying again.",
};

function sameMember(
  row: { user_id?: string | null },
  request: CheckoutReplayRequest,
): boolean {
  return !!request.userId && row.user_id === request.userId;
}

/** Null means no prior attempt. A conflict never contains order IDs or QRs. */
export async function readCheckoutReplay(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  request: CheckoutReplayRequest,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const conflict = { status: 409, body: CHECKOUT_REPLAY_UNAVAILABLE };
  // Defense in depth: callers must reject invalid identities and quantities
  // before looking up an attempt, even if their request plumbing changes.
  if (
    (!request.userId && !request.guestEmail) ||
    !Number.isInteger(request.eventId) ||
    !request.ticketTypeId ||
    !Number.isInteger(request.quantity) || request.quantity < 1
  ) return conflict;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, user_id, guest_email, type, event_id, quantity, status, total_cents, stripe_payment_intent_id, stripe_checkout_session_id")
    .eq("idempotency_key", request.idempotencyKey)
    .maybeSingle();
  // A failed read is not a missing attempt: falling through could mint more.
  if (orderError) throw orderError;
  if (!order) return null;
  // Guest email is unverified and the key is caller-chosen, not a server-
  // issued capability. Never release existing guest QRs on that basis.
  // New guest orders still proceed above; retries recover via their emailed
  // ticket magic link, not this checkout endpoint.
  if (!request.userId) return conflict;
  if (
    !sameMember(order, request) ||
    order.type !== "event_ticket" ||
    order.event_id !== request.eventId ||
    order.quantity !== request.quantity ||
    order.status !== "paid" || order.total_cents !== 0 ||
    order.stripe_payment_intent_id != null ||
    order.stripe_checkout_session_id != null
  ) return conflict;

  const { data: tickets, error: ticketError } = await supabase
    .from("tickets")
    .select("id, qr_token, event_id, ticket_type_id, user_id, guest_email, status")
    .eq("order_id", order.id);
  if (ticketError) throw ticketError;
  // Order insert and ticket insert are separate in these legacy rails. An
  // in-flight winner can exist with no tickets yet; never call that success.
  if (
    !Array.isArray(tickets) || tickets.length !== request.quantity ||
    tickets.some((ticket) =>
      !sameMember(ticket, request) ||
      ticket.event_id !== request.eventId ||
      ticket.ticket_type_id !== request.ticketTypeId ||
      !["active", "scanned", "transfer_pending"].includes(ticket.status) ||
      typeof ticket.id !== "string" || !ticket.id ||
      typeof ticket.qr_token !== "string" || !ticket.qr_token
    )
  ) return conflict;

  return {
    status: 200,
    body: {
      tickets: tickets.map(({ id, qr_token }) => ({ id, qr_token })),
      free: true,
      order_id: order.id,
      idempotent: true,
    },
  };
}
