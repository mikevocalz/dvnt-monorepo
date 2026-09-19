/**
 * Door POS API — web "Sell" rail.
 *
 * Talks to the `door-sell` edge function. All money math happens server
 * side; this module only shapes requests and types responses. A client
 * can never send an amount.
 */

import { invokeEdge } from "./invoke-edge";

export interface DoorQuote {
  currency: string;
  subtotal_cents: number;
  discount_cents: number;
  discounted_subtotal_cents: number;
  fee_cents: number;
  total_cents: number;
  code: string | null;
  quantity: number;
  /** Server-computed: total minus sold minus live holds. Null = unlimited. */
  remaining?: number | null;
}

export interface DoorSellResult {
  ok: boolean;
  free?: boolean;
  order_id: string | null;
  tickets_issued?: number;
  clientSecret?: string;
  publishableKey?: string;
  paymentIntentId?: string;
  quote: DoorQuote;
}

interface DoorSellResponse extends Partial<DoorSellResult> {
  ok?: boolean;
  error?: string;
  code?: string;
  role?: string | null;
  status?: string;
  quantity?: number;
}

function unwrap<T extends { error?: string; code?: string }>(
  data: T | null | undefined,
  error: any,
): T {
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No response from door-sell");
  if (data.error) {
    const err = new Error(data.error) as Error & { code?: string };
    err.code = data.code;
    throw err;
  }
  return data;
}

export const doorApi = {
  /**
   * Server quote for tier + quantity + codes. Creates nothing — the Pay
   * button's amount comes only from this response.
   */
  async quote(params: {
    eventId: number;
    ticketTypeId: string;
    quantity: number;
    promoterCode?: string;
    promoCode?: string;
  }): Promise<DoorQuote> {
    const { data, error } = await invokeEdge<DoorSellResponse>("door-sell", {
      action: "quote",
      event_id: params.eventId,
      ticket_type_id: params.ticketTypeId,
      quantity: params.quantity,
      ...(params.promoterCode ? { promoter_code: params.promoterCode } : {}),
      ...(params.promoCode ? { promo_code: params.promoCode } : {}),
    });
    const res = unwrap(data, error);
    if (!res.quote) throw new Error("Missing quote");
    return res.quote;
  },

  /**
   * Create the hold + PaymentIntent + pending order for a door sale, or
   * run the secure free path when the server total is 0.
   */
  async sell(params: {
    eventId: number;
    ticketTypeId: string;
    quantity: number;
    guestEmail: string;
    guestName?: string;
    promoterCode?: string;
    promoCode?: string;
  }): Promise<DoorSellResult> {
    const { data, error } = await invokeEdge<DoorSellResponse>("door-sell", {
      action: "sell",
      event_id: params.eventId,
      ticket_type_id: params.ticketTypeId,
      quantity: params.quantity,
      guest_email: params.guestEmail,
      ...(params.guestName ? { guest_name: params.guestName } : {}),
      ...(params.promoterCode ? { promoter_code: params.promoterCode } : {}),
      ...(params.promoCode ? { promo_code: params.promoCode } : {}),
    });
    const res = unwrap(data, error);
    return {
      ok: res.ok ?? true,
      free: res.free,
      order_id: res.order_id ?? null,
      tickets_issued: res.tickets_issued,
      clientSecret: res.clientSecret,
      publishableKey: res.publishableKey,
      paymentIntentId: res.paymentIntentId,
      quote: res.quote as DoorQuote,
    };
  },

  /**
   * Fulfillment truth for the success screen: order status + issued
   * ticket count, straight from the DB the webhook writes.
   */
  async status(params: {
    eventId: number;
    orderId: string;
  }): Promise<{
    status: string;
    quantity: number;
    tickets_issued: number;
    ticket_email_status: string | null;
  }> {
    const { data, error } = await invokeEdge<
      DoorSellResponse & { status?: string; ticket_email_status?: string | null }
    >("door-sell", {
      action: "status",
      event_id: params.eventId,
      order_id: params.orderId,
    });
    const res = unwrap(data, error);
    return {
      status: res.status ?? "unknown",
      quantity: res.quantity ?? 0,
      tickets_issued: res.tickets_issued ?? 0,
      ticket_email_status: res.ticket_email_status ?? null,
    };
  },

  /**
   * Re-EMAIL the order's existing ticket bundle to the guest. Never
   * mints tickets, never creates an order, never charges — the edge
   * function rebuilds the canonical bundle and sends it again.
   */
  async resendTickets(params: {
    eventId: number;
    orderId: string;
  }): Promise<void> {
    const { data, error } = await invokeEdge<DoorSellResponse>("door-sell", {
      action: "resend",
      event_id: params.eventId,
      order_id: params.orderId,
    });
    unwrap(data, error);
  },
};

/**
 * Tap to Pay (Phase 5, native only). A connection token is minted per
 * call and scoped to the event's platform-owned Terminal Location —
 * never cache it, never send a Stripe-Account header (separate charges
 * and transfers means the platform owns the PaymentIntent).
 */
export const terminalApi = {
  async connectionToken(eventId: number): Promise<string> {
    const { data, error } = await invokeEdge<{
      secret?: string;
      error?: string;
      code?: string;
    }>("terminal-token", { event_id: eventId });
    const res = unwrap(data, error);
    if (!res.secret) {
      const err = new Error(res.error || "Tap to Pay is not available");
      (err as Error & { code?: string }).code = res.code;
      throw err;
    }
    return res.secret;
  },
};
