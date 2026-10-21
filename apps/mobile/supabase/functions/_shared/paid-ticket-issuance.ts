/** Paid single-tier issuance has exactly one database transaction boundary. */
export interface PaidTicketIssuanceResult {
  duplicate: boolean;
  terminal: boolean;
  orderId: string;
  issued: number;
  tickets: { id: string; qr_token: string; guest_lookup_token: string | null }[];
}

export async function issuePaidTicketsAtomically(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    orderId: string;
    ticketTypeId: string;
    paymentIntentId: string;
    checkoutSessionId: string | null;
    amountCents: number;
    ticketRows: Record<string, unknown>[];
  },
): Promise<PaidTicketIssuanceResult> {
  if (!args.paymentIntentId || !Number.isSafeInteger(args.amountCents) || args.amountCents <= 0) {
    throw new Error("Paid ticket payment identity or amount is invalid");
  }
  const { data, error } = await supabase.rpc("paid_ticket_issuance_atomic", {
    p_order_id: args.orderId,
    p_ticket_type_id: args.ticketTypeId,
    p_payment_intent_id: args.paymentIntentId,
    p_checkout_session_id: args.checkoutSessionId,
    p_amount_cents: args.amountCents,
    p_ticket_rows: args.ticketRows,
  });
  // No direct-write fallback: an absent migration or allocation failure must
  // stay retryable, never split tickets, counters and holds across requests.
  if (error) throw error;
  if (!data?.ok) {
    throw new Error(`Paid ticket allocation needs recovery: ${data?.error || "unknown"}`);
  }
  if (data.order_id !== args.orderId || !Array.isArray(data.tickets) ||
      !Number.isInteger(data.issued_count)) {
    throw new Error("Paid ticket allocation returned an invalid result");
  }
  if (data.terminal === true) {
    if (data.issued_count !== 0 || data.tickets.length !== 0) {
      throw new Error("Terminal paid order attempted new ticket delivery");
    }
  } else if (data.tickets.length !== args.ticketRows.length ||
      (data.duplicate === true ? data.issued_count !== 0 : data.issued_count !== args.ticketRows.length)) {
    throw new Error("Paid ticket allocation returned an incomplete bundle");
  }
  return {
    duplicate: data.duplicate === true,
    terminal: data.terminal === true,
    orderId: data.order_id,
    issued: data.issued_count,
    tickets: data.tickets,
  };
}

/** Preserve every charged cent across a group, including indivisible totals. */
export function paidTicketAmount(amountCents: number, quantity: number, index: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 ||
      !Number.isInteger(quantity) || quantity < 1 ||
      !Number.isInteger(index) || index < 0 || index >= quantity) {
    throw new Error("Invalid paid ticket amount allocation");
  }
  return Math.floor(amountCents / quantity) + (index < amountCents % quantity ? 1 : 0);
}
