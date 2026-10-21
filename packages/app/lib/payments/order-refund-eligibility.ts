import type { Order } from "../types/payments";

/**
 * This opens an order-level support request, not a gateway refund. Completed
 * zero-total orders (free, comp, or fully discounted) have nothing to refund.
 * Use the final total, not the admission price: paid add-ons remain refundable.
 * The support request does not execute a gateway refund or require its intent
 * metadata. The endpoint verifies ownership and the same amount/status rule.
 */
export function canRequestOrderRefund(
  order: Pick<Order, "status" | "fees"> | null | undefined,
): boolean {
  const total = order?.fees?.totalCents;
  return order?.status === "paid" &&
    typeof total === "number" && Number.isSafeInteger(total) && total > 0;
}
