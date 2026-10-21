import type { Cart } from "../contracts/dto";

/** Identity of the buyer-reviewed order, excluding server checkout progress. */
export function reviewedCartKey(cart: Cart | null): string {
  if (!cart) return "";
  return JSON.stringify([
    cart.cartId,
    cart.eventId,
    cart.idempotencyKey,
    cart.lineItems,
  ]);
}

/** Cart metadata/attendees are JSON data; don't retain mutable store references. */
export function snapshotReviewedCart(cart: Cart): Cart {
  return JSON.parse(JSON.stringify(cart)) as Cart;
}
