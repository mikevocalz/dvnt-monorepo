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
  ): Promise<CartCheckoutResponse> {
    const { data, error } = await invokeEdge("cart-checkout", {
      cartId,
      ...(promoCode?.trim() ? { promoCode: promoCode.trim() } : {}),
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
