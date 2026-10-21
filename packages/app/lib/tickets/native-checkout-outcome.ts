/** PaymentSheet completion is not proof that this purchase's tickets exist. */
export interface NativeTicketCheckoutResult {
  success: boolean;
  free?: boolean;
  tickets?: Array<{ id: string; qr_token: string }>;
  error?: string;
  paymentIntentId?: string;
}

/** Purchase reference only, never a local copy of a ticket/QR credential. */
export interface PendingNativeTicketCheckout {
  paymentIntentId: string | null;
  ticketTypeId: string;
  quantity: number;
}

interface IssuedTicket {
  id: string;
  qr_token: string;
  event_id: string | number;
  ticket_type_id: string;
  stripe_payment_intent_id?: string | null;
  status: string;
}

export type NativeTicketCheckoutOutcome =
  | { kind: "issued"; ticketCount: number }
  | { kind: "pending" }
  | { kind: "cancelled" }
  | { kind: "failed"; error: string };

/**
 * The retry path only reads the original purchase. Remember a completed
 * PaymentSheet before the first read so a timeout/navigation/restart cannot
 * turn "check again" into a second payment.
 */
export async function completeNativeTicketCheckout(input: {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  pending?: PendingNativeTicketCheckout;
  checkout: () => Promise<NativeTicketCheckoutResult>;
  rememberPending: (purchase: PendingNativeTicketCheckout) => void;
  clearPending: () => void;
  readTickets: () => Promise<readonly IssuedTicket[]>;
  wait?: () => Promise<void>;
}): Promise<NativeTicketCheckoutOutcome> {
  let purchase = input.pending;
  if (!purchase) {
    const result = await input.checkout();
    if (result.error || !result.success) {
      return result.error === "Payment cancelled"
        ? { kind: "cancelled" }
        : {
            kind: "failed",
            error: result.error || "Checkout did not complete",
          };
    }

    // Free tickets are issued synchronously by this request. A flag or an
    // empty/partial response alone is not proof of the requested issuance.
    if (result.free) {
      const ids = new Set(
        (result.tickets ?? [])
          .filter((ticket) => ticket.id?.trim() && ticket.qr_token?.trim())
          .map((ticket) => ticket.id),
      );
      if (ids.size >= input.quantity) {
        return { kind: "issued", ticketCount: ids.size };
      }
    }

    purchase = {
      paymentIntentId: result.paymentIntentId || null,
      ticketTypeId: input.ticketTypeId,
      quantity: input.quantity,
    };
    input.rememberPending(purchase);
  }

  // Without a purchase reference, an old event ticket proves nothing.
  if (!purchase.paymentIntentId) return { kind: "pending" };

  const wait =
    input.wait ?? (() => new Promise((resolve) => setTimeout(resolve, 1500)));
  for (let attempt = 0; attempt < 5; attempt++) {
    await wait();
    let tickets: readonly IssuedTicket[];
    try {
      tickets = await input.readTickets();
    } catch {
      // A read error after payment must never be presented as payment failure.
      continue;
    }
    const issuedIds = new Set(
      tickets
        .filter(
          (ticket) =>
            String(ticket.event_id) === input.eventId &&
            ticket.ticket_type_id === purchase.ticketTypeId &&
            ticket.stripe_payment_intent_id === purchase.paymentIntentId &&
            (ticket.status === "active" || ticket.status === "scanned") &&
            ticket.id?.trim() &&
            ticket.qr_token?.trim(),
        )
        .map((ticket) => ticket.id),
    );
    if (issuedIds.size >= purchase.quantity) {
      input.clearPending();
      return { kind: "issued", ticketCount: issuedIds.size };
    }
  }
  return { kind: "pending" };
}
