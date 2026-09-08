/**
 * A boost has three independent states, not one.
 *
 * `event_spotlight_campaigns.status` collapses payment, moderation and delivery
 * into a single enum (`pending | pending_payment | active | paused | expired |
 * cancelled | completed | refunded`,
 * `migrations/20260613181543_event_boosting.sql`), which cannot express the
 * states that actually occur: paid but not yet approved, approved but not yet
 * paid, refunded but still inside its window.
 *
 * Keeping them apart is what stops the two mistakes §10 names. "Submitted" is
 * not "Live" — a campaign that has been paid for has not necessarily been
 * approved, and one that is approved has not necessarily started. And "refund
 * requested" is not "refunded".
 *
 * Pure, so the same rules run on the server, in the organizer UI, and in tests.
 */

export type PaymentState =
  | "pending_payment"
  | "paid"
  | "failed"
  | "refunded"
  | "charged_back";

export type ModerationState =
  | "submitted"
  | "approved"
  | "rejected"
  /** The creative or targeting changed materially and needs re-review. */
  | "revalidate";

export type DeliveryState =
  | "scheduled"
  | "active"
  | "paused"
  | "completed"
  | "stopped";

export interface BoostLifecycle {
  payment: PaymentState;
  moderation: ModerationState;
  delivery: DeliveryState;
}

export interface ActivationContext {
  /** The event is published, upcoming, and not cancelled. */
  eventEligible: boolean;
  /** `now` sits inside [starts_at, ends_at]. */
  scheduleCurrent: boolean;
}

/**
 * Delivery may only happen when all five hold. Any one failing stops delivery —
 * there is no combination where a rejected or unpaid campaign is served
 * because the other axes look fine.
 */
export function canDeliver(
  state: BoostLifecycle,
  context: ActivationContext,
): boolean {
  return (
    state.payment === "paid" &&
    state.moderation === "approved" &&
    state.delivery === "active" &&
    context.eventEligible &&
    context.scheduleCurrent
  );
}

/**
 * A refunded or charged-back campaign never resumes, whatever a later webhook
 * says. Out-of-order delivery is normal; a stale "payment succeeded" arriving
 * after a refund must not restart delivery.
 */
export function isTerminatedByPayment(state: BoostLifecycle): boolean {
  return state.payment === "refunded" || state.payment === "charged_back";
}

const PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  pending_payment: ["paid", "failed"],
  paid: ["refunded", "charged_back"],
  failed: ["pending_payment"],
  // Terminal. A refund is the end of the money story.
  refunded: [],
  charged_back: [],
};

const MODERATION_TRANSITIONS: Record<ModerationState, readonly ModerationState[]> = {
  submitted: ["approved", "rejected"],
  approved: ["revalidate", "rejected"],
  rejected: ["submitted"],
  revalidate: ["approved", "rejected"],
};

const DELIVERY_TRANSITIONS: Record<DeliveryState, readonly DeliveryState[]> = {
  scheduled: ["active", "stopped"],
  active: ["paused", "completed", "stopped"],
  paused: ["active", "stopped", "completed"],
  // Terminal.
  completed: [],
  stopped: [],
};

export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}
export function canTransitionModeration(
  from: ModerationState,
  to: ModerationState,
): boolean {
  return MODERATION_TRANSITIONS[from].includes(to);
}
export function canTransitionDelivery(from: DeliveryState, to: DeliveryState): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

export type OrganizerStatus =
  | "awaiting_payment"
  | "payment_failed"
  | "awaiting_review"
  | "rejected"
  | "scheduled"
  | "live"
  | "paused"
  | "ended"
  | "stopped"
  | "refund_requested"
  | "refunded";

/**
 * The one line an organizer reads. Ordered so the thing blocking them comes
 * first: a rejected creative matters more than a scheduled start.
 */
export function organizerStatus(
  state: BoostLifecycle,
  context: ActivationContext,
): OrganizerStatus {
  if (state.payment === "refunded" || state.payment === "charged_back") {
    return "refunded";
  }
  if (state.payment === "failed") return "payment_failed";
  if (state.moderation === "rejected") return "rejected";
  if (state.payment === "pending_payment") return "awaiting_payment";
  if (state.moderation === "submitted" || state.moderation === "revalidate") {
    return "awaiting_review";
  }
  if (state.delivery === "stopped") return "stopped";
  if (state.delivery === "completed") return "ended";
  if (state.delivery === "paused") return "paused";
  if (canDeliver(state, context)) return "live";
  return "scheduled";
}

/**
 * Copy per status. "Submitted" never reads as "Live", and nothing here tells an
 * organizer they were not charged — after a failure we do not know that.
 */
export function organizerStatusCopy(status: OrganizerStatus): {
  label: string;
  detail: string;
} {
  switch (status) {
    case "awaiting_payment":
      return {
        label: "Awaiting payment",
        detail: "We're confirming your payment. Please don't pay again.",
      };
    case "payment_failed":
      return {
        label: "Payment didn't go through",
        detail: "No boost was scheduled. You can try again from here.",
      };
    case "awaiting_review":
      return {
        label: "Boost submitted",
        detail: "It will start after approval, at its scheduled time.",
      };
    case "rejected":
      return {
        label: "Not approved",
        detail:
          "This boost was not approved and will not run. See the reason below.",
      };
    case "scheduled":
      return {
        label: "Scheduled",
        detail: "Approved and waiting for its start time.",
      };
    case "live":
      return {
        label: "Live",
        detail: "Your event has priority in the Home feed.",
      };
    case "paused":
      return {
        label: "Paused",
        detail: "Delivery is stopped. The scheduled window keeps running.",
      };
    case "ended":
      return {
        label: "Ended",
        detail: "Your boost has ended. View your results below.",
      };
    case "stopped":
      return {
        label: "Stopped",
        detail: "This boost was stopped before its end.",
      };
    case "refund_requested":
      return {
        label: "Refund requested",
        detail: "We're processing it. This is not yet a completed refund.",
      };
    case "refunded":
      return {
        label: "Refunded",
        detail: "This boost was refunded and will not run.",
      };
  }
}
