import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner-native";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";
import { cartApi } from "@dvnt/app/lib/api/cart";
import { qk } from "@dvnt/app/lib/query/keys";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCartStore } from "@dvnt/app/lib/stores/cart";
import {
  checkoutCopy,
  resolveCheckoutOutcome,
} from "@dvnt/app/lib/tickets/checkout-outcome";

export function useCartPaymentRecovery() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const cart = useCartStore((state) => state.cart);
  const markCompleted = useCartStore((state) => state.markCompleted);
  const recoveryInFlightRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const recover = useCallback(
    async (source: "mount" | "foreground") => {
      const currentCart = useCartStore.getState().cart;
      if (!currentCart || currentCart.status !== "paying") return;
      if (recoveryInFlightRef.current) return;

      recoveryInFlightRef.current = true;
      AppTrace.trace("CART", "cart_payment_recovery_started", {
        source,
        cartId: currentCart.cartId,
      });

      try {
        const status = await cartApi.getStatus(currentCart.cartId);
        const viewerId = useAuthStore.getState().user?.id || "unknown";
        queryClient.setQueryData(
          qk.cart.status(viewerId, currentCart.cartId),
          status,
        );

        if (status.completed) {
          markCompleted();
          // Same words as the success screen it routes to. An add-on-only
          // order has no tickets, and a completed cart whose credentials have
          // not landed yet is not "ready".
          const outcome = resolveCheckoutOutcome({
            status: status.cart.status,
            tickets: status.tickets,
            addons: status.addons,
            isLoading: false,
            isError: false,
            elapsedMs: 0,
          });
          const copy = checkoutCopy(outcome);
          if (copy.tone === "success") toast.success(copy.title);
          else toast.info(copy.title);
          router.replace({
            pathname: "/(protected)/checkout/success",
            params: { cartId: currentCart.cartId },
          } as any);
        }

        AppTrace.trace("CART", "cart_payment_recovery_finished", {
          source,
          cartId: currentCart.cartId,
          completed: status.completed,
          status: status.cart.status,
        });
      } catch (error: any) {
        AppTrace.warn("CART", "cart_payment_recovery_failed", {
          source,
          cartId: currentCart.cartId,
          error: error?.message || "Recovery failed",
        });
      } finally {
        recoveryInFlightRef.current = false;
      }
    },
    [markCompleted, queryClient, router],
  );

  useEffect(() => {
    if (cart?.status === "paying") {
      recover("mount");
    }
  }, [cart?.cartId, cart?.status, recover]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (
        nextState === "active" &&
        (previousState === "background" || previousState === "inactive")
      ) {
        recover("foreground");
      }
    });

    return () => {
      subscription.remove();
    };
  }, [recover]);
}
