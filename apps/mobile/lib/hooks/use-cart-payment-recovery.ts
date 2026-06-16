import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner-native";
import { AppTrace } from "@/lib/diagnostics/app-trace";
import { cartApi } from "@/lib/api/cart";
import { qk } from "@/lib/query/keys";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useCartStore } from "@/lib/stores/cart";

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
          toast.success("Your tickets are ready");
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
