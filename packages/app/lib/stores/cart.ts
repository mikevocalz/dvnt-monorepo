import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";
import type {
  Cart,
  CartLineItem,
  CartStatus,
  LineItemCategory,
} from "@dvnt/app/lib/contracts/dto";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";

export type { Cart, CartLineItem, CartStatus, LineItemCategory };

interface AddCartLineItemInput extends Omit<
  CartLineItem,
  "lineItemId" | "eventId"
> {
  lineItemId?: string;
  eventId?: string;
}

interface CartState {
  cart: Cart | null;
  startCart: (eventId: string) => Cart;
  ensureCart: (eventId: string) => Cart;
  addLineItem: (
    eventId: string,
    lineItem: AddCartLineItemInput,
  ) => CartLineItem;
  updateLineItemQuantity: (lineItemId: string, quantity: number) => void;
  removeLineItem: (lineItemId: string) => void;
  replaceLineItems: (lineItems: CartLineItem[]) => void;
  setHold: (holdExpiresAt: number) => void;
  setPaymentIntent: (paymentIntentId: string) => void;
  setStatus: (status: CartStatus) => void;
  markCompleted: () => void;
  markAbandoned: () => void;
  clearCart: () => void;
  reset: () => void;
}

function createUuid(): string {
  return crypto.randomUUID();
}

function createDraftCart(eventId: string): Cart {
  return {
    cartId: createUuid(),
    eventId,
    lineItems: [],
    status: "draft",
    idempotencyKey: createUuid(),
  };
}

function traceCart(event: string, cart: Cart | null, extra = {}): void {
  AppTrace.trace("CART", event, {
    cartId: cart?.cartId,
    eventId: cart?.eventId,
    status: cart?.status,
    lineItems: cart?.lineItems.length ?? 0,
    ...extra,
  });
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cart: null,

      startCart: (eventId) => {
        const cart = createDraftCart(eventId);
        set({ cart });
        traceCart("cart_started", cart);
        return cart;
      },

      ensureCart: (eventId) => {
        const current = get().cart;
        if (
          current &&
          current.eventId === eventId &&
          current.status !== "completed"
        ) {
          return current;
        }
        return get().startCart(eventId);
      },

      addLineItem: (eventId, input) => {
        const cart = get().ensureCart(eventId);
        const lineItem: CartLineItem = {
          ...input,
          lineItemId: input.lineItemId ?? createUuid(),
          eventId: input.eventId ?? eventId,
        };

        const nextCart: Cart = {
          ...cart,
          status: cart.status === "abandoned" ? "draft" : cart.status,
          lineItems: [...cart.lineItems, lineItem],
          holdExpiresAt: undefined,
          paymentIntentId: undefined,
        };

        set({ cart: nextCart });
        traceCart("cart_line_item_added", nextCart, {
          lineItemId: lineItem.lineItemId,
          category: lineItem.category,
          tierId: lineItem.tierId,
          quantity: lineItem.quantity,
        });
        return lineItem;
      },

      updateLineItemQuantity: (lineItemId, quantity) => {
        const cart = get().cart;
        if (!cart) return;
        if (quantity <= 0) {
          get().removeLineItem(lineItemId);
          return;
        }

        const nextCart: Cart = {
          ...cart,
          status: cart.status === "holding" ? "draft" : cart.status,
          holdExpiresAt: undefined,
          paymentIntentId: undefined,
          lineItems: cart.lineItems.map((lineItem) =>
            lineItem.lineItemId === lineItemId
              ? { ...lineItem, quantity }
              : lineItem,
          ),
        };

        set({ cart: nextCart });
        traceCart("cart_line_item_quantity_updated", nextCart, {
          lineItemId,
          quantity,
        });
      },

      removeLineItem: (lineItemId) => {
        const cart = get().cart;
        if (!cart) return;

        const nextCart: Cart = {
          ...cart,
          status: cart.status === "holding" ? "draft" : cart.status,
          holdExpiresAt: undefined,
          paymentIntentId: undefined,
          lineItems: cart.lineItems.filter(
            (lineItem) => lineItem.lineItemId !== lineItemId,
          ),
        };

        set({ cart: nextCart });
        traceCart("cart_line_item_removed", nextCart, { lineItemId });
      },

      replaceLineItems: (lineItems) => {
        const cart = get().cart;
        if (!cart) return;

        const nextCart: Cart = {
          ...cart,
          status: cart.status === "holding" ? "draft" : cart.status,
          holdExpiresAt: undefined,
          paymentIntentId: undefined,
          lineItems,
        };

        set({ cart: nextCart });
        traceCart("cart_line_items_replaced", nextCart);
      },

      setHold: (holdExpiresAt) => {
        const cart = get().cart;
        if (!cart) return;
        const nextCart: Cart = { ...cart, holdExpiresAt, status: "holding" };
        set({ cart: nextCart });
        traceCart("cart_hold_created", nextCart, { holdExpiresAt });
      },

      setPaymentIntent: (paymentIntentId) => {
        const cart = get().cart;
        if (!cart) return;
        const nextCart: Cart = { ...cart, paymentIntentId, status: "paying" };
        set({ cart: nextCart });
        traceCart("cart_payment_intent_set", nextCart, { paymentIntentId });
      },

      setStatus: (status) => {
        const cart = get().cart;
        if (!cart) return;
        const nextCart: Cart = { ...cart, status };
        set({ cart: nextCart });
        traceCart("cart_status_changed", nextCart);
      },

      markCompleted: () => {
        const cart = get().cart;
        if (!cart) return;
        const nextCart: Cart = { ...cart, status: "completed" };
        set({ cart: nextCart });
        traceCart("cart_completed", nextCart);
      },

      markAbandoned: () => {
        const cart = get().cart;
        if (!cart) return;
        const nextCart: Cart = { ...cart, status: "abandoned" };
        set({ cart: nextCart });
        traceCart("cart_abandoned", nextCart);
      },

      clearCart: () => {
        const cart = get().cart;
        set({ cart: null });
        traceCart("cart_cleared", cart);
      },

      reset: () => {
        const cart = get().cart;
        set({ cart: null });
        traceCart("cart_reset", cart);
      },
    }),
    {
      name: "cart-storage",
      storage: mmkvStorage,
      partialize: (state) => ({ cart: state.cart }),
    },
  ),
);
