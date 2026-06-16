import { useCallback } from "react";
import { useRouter } from "expo-router";
import { toast } from "sonner-native";
import { useStripeSafe as useStripe } from "@dvnt/app/lib/safe-native-modules";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";
import { cartApi } from "@dvnt/app/lib/api/cart";
import { useCartStore } from "@dvnt/app/lib/stores/cart";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";

interface MixedCartCheckoutResult {
  success: boolean;
  cartId?: string;
  paymentIntentId?: string;
  error?: string;
  cancelled?: boolean;
}

export function useMixedCartCheckout() {
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const setCheckoutLoading = usePaymentsStore(
    (state) => state.setCheckoutLoading,
  );
  const checkoutLoading = usePaymentsStore((state) => state.checkoutLoading);
  const cart = useCartStore((state) => state.cart);
  const setHold = useCartStore((state) => state.setHold);
  const setPaymentIntent = useCartStore((state) => state.setPaymentIntent);

  const checkout = useCallback(async (): Promise<MixedCartCheckoutResult> => {
    if (!cart || cart.lineItems.length === 0) {
      toast.error("Your cart is empty");
      return { success: false, error: "Cart is empty" };
    }

    setCheckoutLoading(true);
    AppTrace.trace("CART", "mixed_cart_checkout_started", {
      cartId: cart.cartId,
      eventId: cart.eventId,
      lineItems: cart.lineItems.length,
    });

    try {
      const hold = await cartApi.createHold(cart);
      const holdExpiresAt = Date.parse(hold.holdExpiresAt);
      if (!Number.isFinite(holdExpiresAt)) {
        throw new Error("Could not verify cart hold");
      }
      setHold(holdExpiresAt);
      AppTrace.trace("CART", "mixed_cart_hold_ready", {
        cartId: cart.cartId,
        holdExpiresAt,
      });

      const payment = await cartApi.checkout(cart.cartId);
      setPaymentIntent(payment.paymentIntentId);
      AppTrace.trace("CART", "mixed_cart_payment_intent_ready", {
        cartId: cart.cartId,
        paymentIntentId: payment.paymentIntentId,
        totalCents: payment.totals.totalCents,
      });

      const expiresAt =
        payment.holdExpiresAt &&
        Number.isFinite(Date.parse(payment.holdExpiresAt))
          ? Date.parse(payment.holdExpiresAt)
          : holdExpiresAt;
      if (expiresAt <= Date.now()) {
        throw new Error(
          "Your reservation expired. Refresh your cart and try again.",
        );
      }

      AppTrace.trace("CART", "mixed_cart_payment_sheet_opening", {
        cartId: cart.cartId,
        paymentIntentId: payment.paymentIntentId,
      });

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: "DVNT",
        customerId: payment.customer,
        customerEphemeralKeySecret: payment.ephemeralKey,
        paymentIntentClientSecret: payment.clientSecret,
        allowsDelayedPaymentMethods: false,
        defaultBillingDetails: { name: "" },
        appearance: {
          colors: {
            primary: "#8A40CF",
            background: "#0A0A0B",
            componentBackground: "#151518",
            componentText: "#ffffff",
            secondaryText: "#a1a1aa",
            placeholderText: "#71717a",
            icon: "#8A40CF",
          },
          shapes: {
            borderRadius: 12,
            borderWidth: 1,
          },
        },
        returnURL: "dvnt://checkout/success",
      });

      if (initError) {
        AppTrace.error("CART", "mixed_cart_payment_sheet_init_failed", {
          cartId: cart.cartId,
          paymentIntentId: payment.paymentIntentId,
          error: initError.message,
        });
        throw new Error(initError.message || "Failed to initialize payment");
      }

      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code === "Canceled") {
          AppTrace.warn("CART", "mixed_cart_payment_sheet_cancelled", {
            cartId: cart.cartId,
            paymentIntentId: payment.paymentIntentId,
          });
          return {
            success: false,
            cancelled: true,
            cartId: cart.cartId,
            paymentIntentId: payment.paymentIntentId,
            error: "Payment cancelled",
          };
        }

        AppTrace.error("CART", "mixed_cart_payment_sheet_failed", {
          cartId: cart.cartId,
          paymentIntentId: payment.paymentIntentId,
          error: presentError.message,
        });
        throw new Error(presentError.message || "Payment failed");
      }

      AppTrace.trace("CART", "mixed_cart_payment_sheet_succeeded", {
        cartId: cart.cartId,
        paymentIntentId: payment.paymentIntentId,
      });

      toast.success("Payment received");
      router.replace({
        pathname: "/(protected)/checkout/success",
        params: { cartId: cart.cartId },
      } as any);

      return {
        success: true,
        cartId: cart.cartId,
        paymentIntentId: payment.paymentIntentId,
      };
    } catch (error: any) {
      const message = error?.message || "Checkout failed";
      AppTrace.error("CART", "mixed_cart_checkout_failed", {
        cartId: cart.cartId,
        error: message,
      });
      toast.error(message);
      return { success: false, cartId: cart.cartId, error: message };
    } finally {
      setCheckoutLoading(false);
    }
  }, [
    cart,
    initPaymentSheet,
    presentPaymentSheet,
    router,
    setCheckoutLoading,
    setHold,
    setPaymentIntent,
  ]);

  return { checkout, isLoading: checkoutLoading };
}
