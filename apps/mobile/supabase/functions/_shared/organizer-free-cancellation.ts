/** Conservative roster hint only. The transaction rechecks every condition under locks. */
export function organizerFreeCancellation(ticket: any, order: any, pendingOrAcceptedTransfer: boolean) {
  const no = (reason: string) => ({ eligible: false, reason });
  if (ticket.status !== 'active' || ticket.checked_in_at != null || ticket.checked_in_by != null)
    return no('Only unused active tickets can be cancelled.');
  if (!ticket.user_id || ticket.transferred_from != null || pendingOrAcceptedTransfer)
    return no('Transferred, transfer-pending or unclaimed tickets require manual review.');
  if (['guest_email', 'guest_phone', 'guest_phone_e164', 'guest_lookup_token', 'claimed_by', 'claimed_at'].some(k => ticket[k] != null))
    return no('Guest or claimed tickets require manual review.');
  if (ticket.category !== 'admission' || ticket.purchase_amount_cents !== 0 ||
      ['stripe_payment_intent_id', 'stripe_checkout_session_id', 'cart_id', 'cart_line_item_id'].some(k => ticket[k] != null))
    return no('Only verified free admission tickets can be cancelled here.');
  if (!order || order.user_id !== ticket.user_id || order.event_id !== ticket.event_id ||
      order.type !== 'event_ticket' || order.status !== 'paid' || order.total_cents !== 0 || order.subtotal_cents !== 0 ||
      (order.discount_cents ?? 0) !== 0 ||
      ['stripe_payment_intent_id', 'stripe_checkout_session_id', 'cart_id', 'promo_code_id'].some(k => order[k] != null))
    return no('The original free order could not be verified. Manual review is required.');
  return { eligible: true, reason: null };
}

export function parseOrganizerCancellation(body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof body.ticket_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.ticket_id) ||
      !Number.isSafeInteger(body.event_id) || body.event_id <= 0 ||
      typeof body.expected_owner_id !== 'string' || !body.expected_owner_id.trim() || body.expected_owner_id.length > 256 ||
      typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.trim().length > 500) return null;
  return { p_ticket_id: body.ticket_id, p_event_id: body.event_id,
    p_expected_owner_id: body.expected_owner_id, p_reason: body.reason.trim() };
}

export const cancellationErrors: Record<string, string> = {
  not_authorized: 'Only the event owner can cancel this ticket.',
  ticket_changed: 'The ticket or its holder changed. Refresh the roster and review it again.',
  not_cancellable: 'This ticket is not eligible for free cancellation. Paid, used, transferred and unverified tickets require manual review.',
  invalid_request: 'Select a ticket and provide a reason between 5 and 500 characters.',
  inventory_inconsistent: 'Ticket inventory needs review. No cancellation was made.',
  financial_review_required: 'This cancellation could change event accounting. No ticket was changed. Contact support for manual review.',
  cancellation_conflict: 'This ticket was already changed by another action. Refresh the roster.',
};
