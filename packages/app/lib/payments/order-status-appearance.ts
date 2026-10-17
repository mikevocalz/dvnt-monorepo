/**
 * Attendee-facing label for an order's CURRENT money status.
 * A legacy 'payment_failed' row does not establish a declined card:
 * checkout expiration and abandonment share that database status.
 */
import { PAYMENT_STATUS_CONFIG, type Order } from "../types/payments";

export function getOrderStatusAppearance(
  order: Pick<Order, "status" | "checkoutFailureReason">,
): { bg: string; text: string; label: string } {
  if (order.status !== "payment_failed") {
    return PAYMENT_STATUS_CONFIG[order.status] ?? PAYMENT_STATUS_CONFIG.pending;
  }
  const neutral = { bg: "rgba(234, 179, 8, 0.15)", text: "#EAB308" };
  const danger = { bg: "rgba(239, 68, 68, 0.15)", text: "#EF4444" };
  const muted = { bg: "rgba(107, 114, 128, 0.15)", text: "#9CA3AF" };
  switch (order.checkoutFailureReason) {
    case "checkout_expired": return { ...neutral, label: "Checkout expired" };
    case "checkout_abandoned": return { ...neutral, label: "Not completed" };
    case "payment_cancelled": return { ...muted, label: "Payment cancelled" };
    case "payment_declined": return { ...danger, label: "Payment declined" };
    case "payment_attempt_failed": return { ...neutral, label: "Payment incomplete" };
    case "async_payment_failed": return { ...danger, label: "Bank payment failed" };
    case "payment_reference_missing": return { ...neutral, label: "Payment unavailable" };
    case "technical_failure": return { ...danger, label: "Payment error" };
    default: return { ...neutral, label: "Not completed" };
  }
}
