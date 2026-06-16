/**
 * useTicketCheckout — Native Stripe PaymentSheet hook
 *
 * Replaces the browser-redirect Stripe Checkout flow with
 * an in-app native payment sheet for a seamless UX.
 *
 * Falls back to Stripe Checkout (browser redirect) if PaymentSheet
 * initialization fails for any reason.
 *
 * STATE: isLoading lives in usePaymentsStore.checkoutLoading (no useState).
 */

import { useCallback } from "react";
import { initStripe } from "@stripe/stripe-react-native";
import { useStripeSafe as useStripe } from "@/lib/safe-native-modules";
import { supabase } from "@/lib/supabase/client";
import { useUIStore } from "@/lib/stores/ui-store";
import { requireBetterAuthToken } from "@/lib/auth/identity";
import { usePaymentsStore } from "@/lib/stores/payments-store";

interface CheckoutParams {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  promoCode?: string;
  userId?: string; // deprecated — server derives from session
}

interface CheckoutResult {
  success: boolean;
  free?: boolean;
  tickets?: Array<{ id: string; qr_token: string }>;
  error?: string;
  paymentIntentId?: string;
}

export function useTicketCheckout() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const showToast = useUIStore((s) => s.showToast);
  const setCheckoutLoading = usePaymentsStore((s) => s.setCheckoutLoading);
  const checkoutLoading = usePaymentsStore((s) => s.checkoutLoading);

  const checkout = useCallback(
    async (params: CheckoutParams): Promise<CheckoutResult> => {
      const { eventId, ticketTypeId, quantity, promoCode } = params;
      setCheckoutLoading(true);

      try {
        // Get Better Auth token for session verification
        const token = await requireBetterAuthToken();

        // Step 1: Create PaymentIntent via edge function
        const { data, error } = await supabase.functions.invoke(
          "create-payment-intent",
          {
            body: {
              event_id: eventId,
              ticket_type_id: ticketTypeId,
              quantity,
              ...(promoCode ? { promo_code: promoCode } : {}),
            },
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (error) {
          // Extract actual error from edge function response body
          let msg = "Failed to create payment";
          try {
            const ctx = await (error as any).context?.json?.();
            if (ctx?.error) msg = ctx.error;
          } catch {}
          if (msg === "Failed to create payment") msg = error.message || msg;
          throw new Error(msg);
        }

        const result = typeof data === "string" ? JSON.parse(data) : data;

        if (result.error) throw new Error(result.error);

        // Free ticket — already issued server-side
        if (result.free && result.tickets) {
          return { success: true, free: true, tickets: result.tickets };
        }

        // Step 2: Initialize native PaymentSheet
        const { paymentIntent, ephemeralKey, customer, publishableKey } =
          result;

        if (!paymentIntent || !ephemeralKey || !customer) {
          throw new Error("Missing PaymentSheet parameters from server");
        }

        // Re-initialize Stripe with the publishable key returned by the
        // server. The bundle-time EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY can
        // be stale (e.g. an OTA published before the EAS env was set), so
        // we always trust the server's response which reads from the
        // edge-function secret store at request time.
        //
        // Apple Pay merchantIdentifier is included now (was previously
        // suppressed while the processing certificate at Stripe was
        // pending). If the cert is not yet uploaded at Stripe, the sheet
        // simply won't surface Apple Pay — it will not error.
        if (publishableKey) {
          try {
            await initStripe({
              publishableKey,
              merchantIdentifier: "merchant.com.dvnt.app",
            });
          } catch (e) {
            console.warn(
              "[useTicketCheckout] initStripe re-init failed (continuing):",
              e,
            );
          }
        }

        const { error: initError } = await initPaymentSheet({
          merchantDisplayName: "DVNT",
          customerId: customer,
          customerEphemeralKeySecret: ephemeralKey,
          paymentIntentClientSecret: paymentIntent,
          allowsDelayedPaymentMethods: false,
          defaultBillingDetails: { name: "" },
          // Apple Pay: shows the native sheet button on iOS when the
          // user has cards in Wallet AND Stripe has the processing cert
          // for our merchantIdentifier. merchantCountryCode is required
          // by Stripe SDK; US is correct for the production account.
          applePay: { merchantCountryCode: "US" },
          // Google Pay: shows on Android. testEnv mirrors the
          // STRIPE_SECRET_KEY mode so live keys → real GPay flow.
          googlePay: {
            merchantCountryCode: "US",
            currencyCode: "USD",
            testEnv: !!publishableKey?.startsWith("pk_test_"),
          },
          appearance: {
            colors: {
              primary: "#8A40CF",
              background: "#1a1a1a",
              componentBackground: "#262626",
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
          returnURL: "dvnt://tickets/success",
        });

        if (initError) {
          console.error(
            "[useTicketCheckout] initPaymentSheet error:",
            initError,
          );
          throw new Error(initError.message || "Failed to initialize payment");
        }

        // Step 3: Present PaymentSheet to user
        const { error: presentError } = await presentPaymentSheet();

        if (presentError) {
          // User cancelled — not a real error
          if (presentError.code === "Canceled") {
            return { success: false, error: "Payment cancelled" };
          }
          // Split log into individual key=value lines so iOS syslog can't
          // truncate the message (each console.error is its own line).
          console.error("[useTicketCheckout] presentPaymentSheet failed");
          console.error("  code:", presentError.code);
          console.error("  message:", presentError.message);
          console.error(
            "  localizedMessage:",
            (presentError as any).localizedMessage,
          );
          console.error(
            "  declineCode:",
            (presentError as any).declineCode,
          );
          console.error(
            "  stripeErrorCode:",
            (presentError as any).stripeErrorCode,
          );
          throw new Error(presentError.message || "Payment failed");
        }

        // Step 4: Payment succeeded (webhook will finalize tickets)
        return {
          success: true,
          paymentIntentId: result.paymentIntentId,
        };
      } catch (err: any) {
        console.error("[useTicketCheckout] Error:", err);
        return { success: false, error: err.message || "Checkout failed" };
      } finally {
        setCheckoutLoading(false);
      }
    },
    [initPaymentSheet, presentPaymentSheet, setCheckoutLoading],
  );

  return { checkout, isLoading: checkoutLoading };
}
