/**
 * Reasons attached to non-completed checkouts. The legacy money state
 * "payment_failed" also includes abandoned/expired checkout sessions.
 * Never infer a declined card from an expiry or a still-unconfirmed intent.
 * No raw Stripe error messages or payment credentials are persisted.
 */
export type CheckoutFailureReason =
  | "checkout_expired"
  | "checkout_abandoned"
  | "payment_cancelled"
  | "payment_declined"
  | "payment_attempt_failed"
  | "async_payment_failed"
  | "payment_reference_missing"
  | "technical_failure";

export function safeStripeFailureCode(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value)
    ? value
    : null;
}

export function classifyPaymentIntentFailure(
  intent: { last_payment_error?: {
    code?: unknown;
    decline_code?: unknown;
  } | null },
): { reason: CheckoutFailureReason; code: string | null } {
  const error = intent.last_payment_error;
  const declineCode = safeStripeFailureCode(error?.decline_code);
  const code = safeStripeFailureCode(error?.code);
  return {
    // "card_declined" or an actual Stripe decline_code proves a decline.
    // A failed attempt without either is NOT assumed to be a card decline.
    reason: declineCode || code === "card_declined"
      ? "payment_declined"
      : "payment_attempt_failed",
    code: declineCode ?? code,
  };
}

export function classifyReconciledFailure(input: {
  paymentStatus: string;
  checkoutSessionStatus?: string | null;
  cancellationReason?: string | null;
}): CheckoutFailureReason | null {
  const { paymentStatus, checkoutSessionStatus, cancellationReason } = input;
  if (checkoutSessionStatus === "expired") return "checkout_expired";
  if (checkoutSessionStatus === "open" && paymentStatus === "unpaid") {
    // Caller must expire the Stripe session successfully before recording.
    return "checkout_expired";
  }
  if (paymentStatus === "expired" || paymentStatus === "unpaid") {
    return "checkout_expired";
  }
  if (paymentStatus === "canceled") {
    return cancellationReason === "abandoned"
      ? "checkout_abandoned"
      : "payment_cancelled";
  }
  if (paymentStatus === "error:resource_missing") {
    return "payment_reference_missing";
  }
  return null; // processing, requires_action, API errors, or unknown
}

export function checkoutFailureLabel(reason: CheckoutFailureReason): string {
  switch (reason) {
    case "checkout_expired": return "Checkout expired";
    case "checkout_abandoned": return "Checkout abandoned";
    case "payment_cancelled": return "Payment cancelled";
    case "payment_declined": return "Payment declined";
    case "payment_attempt_failed": return "Payment attempt not completed";
    case "async_payment_failed": return "Bank payment failed";
    case "payment_reference_missing": return "Payment reference not found";
    case "technical_failure": return "Technical payment failure";
  }
}
