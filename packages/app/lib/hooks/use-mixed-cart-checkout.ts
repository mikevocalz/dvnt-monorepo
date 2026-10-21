import { useCallback } from "react";
import { useRouter } from "expo-router";
import { toast } from "sonner-native";
import { initStripe } from "@stripe/stripe-react-native";
import { useStripeSafe as useStripe } from "@dvnt/app/lib/safe-native-modules";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";
import type { CartCheckoutResponse } from "@dvnt/app/lib/contracts/dto";
import { cartApi } from "@dvnt/app/lib/api/cart";
import {
  reviewedCartKey,
  snapshotReviewedCart,
} from "@dvnt/app/lib/checkout/reviewed-cart";
import { useCartStore } from "@dvnt/app/lib/stores/cart";
import { getPendingPromoterRef } from "@dvnt/app/lib/stores/promoter-ref-store";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { useCheckoutPhoneStore } from "@dvnt/app/lib/stores/checkout-phone-store";
import { isPhoneRequiredError } from "@dvnt/app/lib/checkout/member-phone";

interface MixedCartCheckoutResult {
  success: boolean;
  cartId?: string;
  paymentIntentId?: string;
  error?: string;
  cancelled?: boolean;
}

// Keep client secrets in memory only. A cancelled sheet may reopen the exact
// same intent, but must never refresh/rewrite a payment-bound cart's lines.
let pendingNativePayment: {
  cartId: string;
  reviewKey: string;
  payment: CartCheckoutResponse;
  expiresAt: number;
  confirmed?: boolean;
} | null = null;
const NEW_CART_MESSAGE =
  "This cart already has a payment. Clear the cart and add tickets again to start a new order.";

export function useMixedCartCheckout() {
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const setCheckoutLoading = usePaymentsStore(
    (state) => state.setCheckoutLoading,
  );
  const checkoutLoading = usePaymentsStore((state) => state.checkoutLoading);
  const setHold = useCartStore((state) => state.setHold);
  const setPaymentIntent = useCartStore((state) => state.setPaymentIntent);

  const checkout = useCallback(async (): Promise<MixedCartCheckoutResult> => {
    // Shared, synchronous lock: neither same-tick presses nor stale callbacks
    // may create a second hold/PaymentSheet before React renders again.
    if (usePaymentsStore.getState().checkoutLoading) {
      return { success: false, error: "Checkout already in progress" };
    }
    const currentCart = useCartStore.getState().cart;
    const cart = currentCart ? snapshotReviewedCart(currentCart) : null;

    if (!cart || cart.lineItems.length === 0) {
      toast.error("Your cart is empty");
      return { success: false, error: "Cart is empty" };
    }

    // A buyer the server already asked for a phone must have typed one.
    const phone = useCheckoutPhoneStore.getState().forRequest();
    if (!phone.ok) {
      toast.error(phone.message);
      return { success: false, error: phone.message };
    }

    const reviewKey = reviewedCartKey(cart);
    const requireCurrentCart = () => {
      if (reviewedCartKey(useCartStore.getState().cart) !== reviewKey) {
        throw new Error("Your cart changed. Review it before paying.");
      }
    };
    setCheckoutLoading(true);
    AppTrace.trace("CART", "mixed_cart_checkout_started", {
      cartId: cart.cartId,
      eventId: cart.eventId,
      lineItems: cart.lineItems.length,
    });

    try {
      let saved =
        pendingNativePayment?.cartId === cart.cartId
          ? pendingNativePayment
          : null;
      if (saved && saved.reviewKey !== reviewKey)
        throw new Error(NEW_CART_MESSAGE);
      if (
        !saved &&
        (cart.paymentIntentId ||
          cart.status === "paying" ||
          cart.status === "completed")
      ) {
        throw new Error(NEW_CART_MESSAGE);
      }
      if (!saved) {
        const hold = await cartApi.createHold(cart);
        const holdExpiresAt = Date.parse(hold.holdExpiresAt);
        if (!Number.isFinite(holdExpiresAt))
          throw new Error("Could not verify cart hold");
        requireCurrentCart();
        setHold(holdExpiresAt);
        AppTrace.trace("CART", "mixed_cart_hold_ready", {
          cartId: cart.cartId,
          holdExpiresAt,
        });

        let payment;
        try {
          payment = await cartApi.checkout(
            cart.cartId,
            undefined,
            getPendingPromoterRef(cart.eventId),
            phone.phone,
          );
        } catch (err) {
          if (isPhoneRequiredError(err))
            useCheckoutPhoneStore.getState().markNeeded();
          throw err;
        }
        if (payment.cartId !== cart.cartId)
          throw new Error("Could not verify the payment's cart.");
        useCheckoutPhoneStore.getState().reset();
        const expiresAt =
          payment.holdExpiresAt &&
          Number.isFinite(Date.parse(payment.holdExpiresAt))
            ? Date.parse(payment.holdExpiresAt)
            : holdExpiresAt;
        saved = { cartId: cart.cartId, reviewKey, payment, expiresAt };
        pendingNativePayment = saved;
        requireCurrentCart();
        setPaymentIntent(payment.paymentIntentId);
        AppTrace.trace("CART", "mixed_cart_payment_intent_ready", {
          cartId: cart.cartId,
          paymentIntentId: payment.paymentIntentId,
          totalCents: payment.totals.totalCents,
        });
      }
      const { payment, expiresAt } = saved;
      if (saved.confirmed) {
        router.replace({
          pathname: "/(protected)/checkout/success",
          params: { cartId: cart.cartId },
        } as any);
        return {
          success: true,
          cartId: cart.cartId,
          paymentIntentId: payment.paymentIntentId,
        };
      }
      if (expiresAt <= Date.now()) {
        throw new Error(
          "Your reservation expired. Clear the cart and add tickets again to start a new order.",
        );
      }

      AppTrace.trace("CART", "mixed_cart_payment_sheet_opening", {
        cartId: cart.cartId,
        paymentIntentId: payment.paymentIntentId,
      });

      // Re-init with the server's key and the Apple Pay merchant id, the same
      // way the single-ticket path does. Without it this path never set a
      // merchantIdentifier, so Apple Pay could not appear on it at all.
      if (payment.publishableKey) {
        try {
          await initStripe({
            publishableKey: payment.publishableKey,
            merchantIdentifier: "merchant.com.dvnt.app",
          });
        } catch (e) {
          console.warn(
            "[useMixedCartCheckout] initStripe re-init failed (continuing):",
            e,
          );
        }
      }

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: "DVNT",
        customerId: payment.customer,
        customerEphemeralKeySecret: payment.ephemeralKey,
        paymentIntentClientSecret: payment.clientSecret,
        allowsDelayedPaymentMethods: false,
        defaultBillingDetails: { name: "" },
        // Wallets, matching the single-ticket path. This path had NEITHER, so
        // a member buying an admission ticket was offered Apple Pay and the
        // same member buying that ticket plus a coat check was not. Stripe's
        // sheet hides a wallet the device or account cannot use, so passing
        // the config is safe regardless of availability.
        applePay: { merchantCountryCode: "US" },
        googlePay: {
          merchantCountryCode: "US",
          currencyCode: "USD",
          testEnv: !!payment.publishableKey?.startsWith("pk_test_"),
        },
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

      requireCurrentCart();
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

      saved.confirmed = true;
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
    initPaymentSheet,
    presentPaymentSheet,
    router,
    setCheckoutLoading,
    setHold,
    setPaymentIntent,
  ]);

  return { checkout, isLoading: checkoutLoading };
}
