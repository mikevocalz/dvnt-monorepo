/**
 * Door POS sale helpers — pure, no imports, so they run under the
 * node:test .cjs harness (see door-sale.test.cjs).
 *
 * Invariants enforced here (see .claude/skills/dvnt-money-path):
 *  - A door ticket is never assigned to the seller: guest rows carry
 *    user_id null. `sold_by_staff_user_id` lives on the ORDER, not on the
 *    ticket's owner fields.
 *  - Guest ticket rows mint their own `guest_lookup_token` so the
 *    confirmation email's lookup link works exactly like online guest
 *    checkout.
 */

export interface DoorSaleMetadata {
  isDoorSale: boolean;
  userId: string | null;
  guestEmail: string | null;
  guestName: string | null;
  soldByStaffUserId: string | null;
}

/**
 * Read PaymentIntent metadata for the `event_ticket` rail. Door sales set
 * `is_door_sale=true`, `guest_email`, and `sold_by_staff_user_id`; online
 * sales set `user_id` and no door fields. Both paths land here so the
 * webhook can shape ticket rows correctly.
 */
export function parseDoorSaleMetadata(
  // deno-lint-ignore no-explicit-any
  metadata: any,
): DoorSaleMetadata {
  const meta = metadata || {};
  const isDoorSale = meta.is_door_sale === "true" || meta.is_door_sale === true;
  const guestEmail =
    typeof meta.guest_email === "string" && meta.guest_email.trim()
      ? meta.guest_email.trim().toLowerCase()
      : null;
  const guestName =
    typeof meta.guest_name === "string" && meta.guest_name.trim()
      ? meta.guest_name.trim()
      : null;
  const soldBy =
    typeof meta.sold_by_staff_user_id === "string" &&
    meta.sold_by_staff_user_id.trim()
      ? meta.sold_by_staff_user_id.trim()
      : null;
  const userId =
    typeof meta.user_id === "string" && meta.user_id.trim()
      ? meta.user_id.trim()
      : null;
  return {
    isDoorSale,
    // A door sale's buyer is the guest email, never the staff user id —
    // even if a caller accidentally stamps user_id on the metadata.
    userId: isDoorSale ? null : userId,
    guestEmail,
    guestName,
    soldByStaffUserId: soldBy,
  };
}

/**
 * Ticket row shaping for guest/door sales. `valid` gates the whole write:
 * a door sale with no deliverable email must not mint orphaned tickets.
 */
export const doorGuestTicketBase = {
  valid(parsed: DoorSaleMetadata): boolean {
    return !parsed.isDoorSale || !!parsed.guestEmail;
  },

  build(opts: {
    eventId: number;
    ticketTypeId: string;
    guestEmail: string;
    guestName: string | null;
    paymentIntentId: string;
    quantity: number;
    amountCents: number;
    index: number; // 0-based position in the order
  }) {
    const qty = Math.max(1, Math.floor(opts.quantity));
    // Deterministic remainder: earlier tickets absorb the extra cents, so
    // per-ticket amounts always sum to the charged amount.
    const base = Math.floor(opts.amountCents / qty);
    const remainder = opts.amountCents - base * qty;
    const purchaseCents = base + (opts.index < remainder ? 1 : 0);
    return {
      event_id: opts.eventId,
      ticket_type_id: opts.ticketTypeId,
      user_id: null,
      guest_email: opts.guestEmail,
      guest_name: opts.guestName,
      guest_lookup_token: crypto.randomUUID(),
      status: "active",
      stripe_payment_intent_id: opts.paymentIntentId,
      purchase_amount_cents: purchaseCents,
      order_index: opts.index + 1,
      order_count: qty,
    };
  },
};

/** j***@mail.com — for the seller-facing fulfilled panel. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email[0]}***@${email.slice(at + 1)}`;
}
