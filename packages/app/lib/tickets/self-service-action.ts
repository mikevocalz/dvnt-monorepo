/** Server-authorized action for this credential, never the event's list price. */
export type TicketSelfServiceAction = "cancel_free" | "refund" | "refund_line";

type TicketActionInput = {
  status: string;
  checked_in_at?: string | null;
  transferred_from?: string | null;
  purchase_amount_cents?: number | null;
  stripe_payment_intent_id?: string | null;
  cart_id?: string | null;
  cart_line_item_id?: string | null;
  event_date?: string;
  self_service_action?: TicketSelfServiceAction | null;
};

/** Missing server eligibility is unknown, not permission to cancel or refund. */
export function getTicketSelfServiceAction(
  ticket: TicketActionInput | undefined,
  now = Date.now(),
): TicketSelfServiceAction | null {
  if (!ticket || ticket.status !== "active" || ticket.checked_in_at != null || ticket.transferred_from != null) return null;
  const amount = ticket.purchase_amount_cents;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) return null;
  const starts = Date.parse(ticket.event_date ?? "");
  // Retain the existing UI's conservative 24-hour cutoff, including on submit.
  if (!Number.isFinite(starts) || starts - now <= 86_400_000) return null;
  if (ticket.self_service_action === "cancel_free") return amount === 0 && !ticket.cart_line_item_id ? "cancel_free" : null;
  if (amount <= 0) return null;
  if (ticket.self_service_action === "refund_line") {
    return ticket.cart_id && ticket.cart_line_item_id ? "refund_line" : null;
  }
  if (ticket.self_service_action === "refund" && !ticket.cart_line_item_id && ticket.stripe_payment_intent_id) return "refund";
  return null;
}

export function ticketSelfServiceCopy(action: TicketSelfServiceAction | null, category?: string) {
  const free = action === "cancel_free";
  const rsvp = free && (!category || category === "admission");
  return {
    label: free ? (rsvp ? "Cancel RSVP" : "Cancel Ticket") : "Request Refund",
    title: rsvp ? "Cancel this RSVP?" : "Cancel this ticket?",
    body: free
      ? "Only this free ticket will be cancelled. No money will be refunded. This cannot be undone."
      : action === "refund_line"
        ? "This cancels every ticket or pass from this cart line. Other items from the same checkout stay active."
        : "A refund will be issued to your original payment method. Funds typically appear within 5–10 business days.",
    loading: free ? "Cancelling..." : "Processing refund...",
    errorTitle: free ? "Cancellation failed" : "Refund failed",
    successTitle: rsvp ? "RSVP cancelled" : "Ticket cancelled",
    successMessage: free ? "Your free ticket has been cancelled." : "Refund processed successfully",
  };
}
