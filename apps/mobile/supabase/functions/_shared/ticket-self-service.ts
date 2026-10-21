/** Authoritative action projection. Missing prices/context never imply free. */
export type TicketSelfServiceAction = "cancel_free" | "refund" | "refund_line";

export interface SelfServiceTicket {
  id: string;
  event_id: number;
  user_id: string | null;
  status: string | null;
  checked_in_at?: string | null;
  transferred_from?: string | null;
  purchase_amount_cents: number | null;
  stripe_payment_intent_id?: string | null;
  order_id?: string | null;
  cart_id?: string | null;
  cart_line_item_id?: string | null;
}
export interface SelfServiceEvent {
  start_date: string | null;
  refund_policy?: string | null;
  refund_days_before?: number | null;
}
export interface SelfServiceOrder {
  id: string;
  event_id: number | null;
  user_id: string | null;
  status: string | null;
  total_cents: number | null;
  cart_id?: string | null;
}
export interface SelfServiceCart {
  id: string;
  event_id: number;
  user_id: string | null;
  status: string;
  stripe_pi_id?: string | null;
}
export interface SelfServiceLine {
  id: string;
  cart_id: string;
  tier_id: string | null;
  addon_id: string | null;
  quantity: number;
  unit_price_cents: number;
  refunded_amount_cents: number;
}

export function getTicketSelfServiceAction({
  ticket, event, order, cart, line, userId, now = Date.now(),
}: {
  ticket: SelfServiceTicket;
  event: SelfServiceEvent | null | undefined;
  order?: SelfServiceOrder | null;
  cart?: SelfServiceCart | null;
  line?: SelfServiceLine | null;
  userId: string;
  now?: number;
}): TicketSelfServiceAction | null {
  if (!userId || ticket.user_id !== userId || ticket.status !== "active" ||
      ticket.checked_in_at != null || ticket.transferred_from != null) return null;
  const cents = ticket.purchase_amount_cents;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents < 0) return null;
  const start = event?.start_date ? Date.parse(event.start_date) : NaN;
  // Retain the existing UI's conservative 24-hour self-service cutoff.
  if (!Number.isFinite(start) || !Number.isFinite(now) || start - now <= 86_400_000) return null;
  const policy = event?.refund_policy ?? "before_event";
  if (!["before_event", "days_before", "always"].includes(policy)) return null;
  if (policy === "days_before") {
    const days = event?.refund_days_before ?? 0;
    if (!Number.isFinite(days) || days < 0 || now > start - days * 86_400_000) return null;
  }
  if (ticket.order_id && (!order || order.id !== ticket.order_id ||
      order.user_id !== userId || order.event_id !== ticket.event_id ||
      !["paid", "partially_refunded"].includes(order.status ?? ""))) return null;

  if (cents === 0) {
    // A synthetic cart_id groups legacy free RSVPs; only a real cart line or
    // order.cart_id proves cart issuance. Cart cancellation is not a refund.
    if (ticket.cart_line_item_id || order?.cart_id ||
        (ticket.cart_id && !order) ||
        (order && (order.total_cents !== 0 || order.status !== "paid"))) return null;
    return "cancel_free";
  }
  if (ticket.cart_line_item_id) {
    if (!cart || cart.id !== ticket.cart_id || cart.user_id !== userId ||
        cart.event_id !== ticket.event_id || cart.status !== "completed" || !cart.stripe_pi_id ||
        !line || line.id !== ticket.cart_line_item_id || line.cart_id !== cart.id ||
        !line.tier_id || line.addon_id ||
        !Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
        !Number.isSafeInteger(line.unit_price_cents) || line.unit_price_cents <= 0 ||
        !Number.isSafeInteger(line.refunded_amount_cents) || line.refunded_amount_cents < 0 ||
        line.unit_price_cents * line.quantity <= line.refunded_amount_cents) return null;
    return "refund_line";
  }
  if (order?.cart_id || ticket.cart_id || !ticket.stripe_payment_intent_id) return null;
  return "refund";
}
