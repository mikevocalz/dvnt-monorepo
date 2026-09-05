import {
  CartCheckoutResponseDTO,
  CartHoldResponseDTO,
  CartStatusResponseDTO,
  parseDTO,
  type Cart,
  type CartCheckoutResponse,
  type CartHoldResponse,
  type CartStatusResponse,
} from "@dvnt/app/lib/contracts/dto";
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";
import { useCartStore } from "@dvnt/app/lib/stores/cart";
import { getPendingPromoterRef } from "@dvnt/app/lib/stores/promoter-ref-store";

function toServerEventId(eventId: string): number {
  const parsed = Number(eventId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Cart event id must be a positive integer");
  }
  return parsed;
}

export const cartApi = {
  async createHold(cart: Cart): Promise<CartHoldResponse> {
    const { data, error } = await invokeEdge("cart-create-hold", {
      cartId: cart.cartId,
      eventId: toServerEventId(cart.eventId),
      idempotencyKey: cart.idempotencyKey,
      lineItems: cart.lineItems,
    });

    if (error) throw new Error(error.message);
    return parseDTO(CartHoldResponseDTO, data);
  },

  async checkout(
    cartId: string,
    promoCode?: string,
    /**
     * Promoter attribution code (WS-4) — pending ?ref= from a tracked
     * share link. Passed by the checkout hook (which knows the cart's
     * eventId); never affects pricing.
     */
    promoterCode?: string | null,
  ): Promise<CartCheckoutResponse> {
    // Fallback: when the caller doesn't pass a code, resolve the
    // pending ?ref= for the ACTIVE cart's event from the persisted
    // store (covers call sites that only know the cartId).
    let resolvedPromoterCode = promoterCode?.trim() || "";
    if (!resolvedPromoterCode) {
      const activeCart = useCartStore.getState().cart;
      if (activeCart?.cartId === cartId && activeCart.eventId) {
        resolvedPromoterCode = getPendingPromoterRef(activeCart.eventId) || "";
      }
    }
    const { data, error } = await invokeEdge("cart-checkout", {
      cartId,
      ...(promoCode?.trim() ? { promoCode: promoCode.trim() } : {}),
      ...(resolvedPromoterCode ? { promoterCode: resolvedPromoterCode } : {}),
    });
    if (error) throw new Error(error.message);
    return parseDTO(CartCheckoutResponseDTO, data);
  },

  async getStatus(cartId: string): Promise<CartStatusResponse> {
    const { data, error } = await invokeEdge("get-cart-status", { cartId });
    if (error) throw new Error(error.message);
    return parseDTO(CartStatusResponseDTO, data);
  },
};
