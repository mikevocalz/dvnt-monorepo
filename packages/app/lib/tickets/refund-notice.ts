/**
 * What a refunded pass says, to staff and to the person who bought it.
 *
 * One source, because a door telling a guest "Refunded" while that guest's own
 * screen says "Revoked" is two answers to one question, and the guest is
 * holding the phone that disagrees with the staff member.
 *
 * "Revoked" was the only word the holder's screen had — `refunded` and `void`
 * both collapsed into it. They are not the same event. Void is a pass that was
 * cancelled; refunded is a purchase that was returned, and the difference is
 * whether the person did something wrong or simply has their money back.
 */

/** Why these refunds happened, in the organiser's words. */
export const REFUND_REASON = "Prior event cancellation/double creation/merger";

/**
 * When the money actually lands.
 *
 * Stated because the alternative is a support message. A card refund is
 * settled at Stripe the moment it is issued and still takes days to appear on
 * a statement, so a holder who checks their bank and sees nothing concludes
 * the refund failed.
 */
export const REFUND_TIMING =
  "Refunds return to the original payment method and can take 5–10 days to appear.";

/** Holder-facing headline. Says what happened, not what was done to them. */
export const REFUND_TITLE = "This ticket was refunded";

/** Door-facing line — the same fact, aimed at someone working a queue. */
export const REFUND_DOOR_NOTE = "These passes were refunded and cannot be checked in.";
