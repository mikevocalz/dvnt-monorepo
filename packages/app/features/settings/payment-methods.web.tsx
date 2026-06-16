"use client";

/**
 * Payment Methods settings — web (port of native
 * `app/settings/payment-methods.tsx`).
 *
 * Law 1 (data is sacred): identical data flow to native. The list comes from
 * `paymentMethodsApi.list()` into the shared `usePaymentsStore` (methods /
 * isLoading / error / setMethods / setLoading / setError / removeMethod /
 * setDefault). Set-default → `paymentMethodsApi.setDefault(id)` with the same
 * optimistic store mutation + rollback-on-fail + toast. Remove →
 * `paymentMethodsApi.remove(id)` with the same optimistic remove + rollback +
 * toast. Add-card uses the EXACT same server mutation native calls —
 * `paymentMethodsApi.createSetupIntent()` — then, instead of Stripe's native
 * PaymentSheet, drives `@stripe/stripe-js` + `@stripe/react-stripe-js`'s
 * `PaymentElement` / `stripe.confirmSetup` web-safely inside the kit Dialog.
 * On success it refreshes the list exactly like native (`loadMethods`). Toasts
 * mirror native through `useUIStore.showToast`.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off) — no
 * <View>/<Text>. Sticky header titled "Payment Methods" + close X like
 * legal-page.web.tsx, content max-w-2xl, bg #06070d, cyan #3FDCFF accent. Card
 * rows use a rounded-square brand tile (never circular, never a pill). The
 * DEFAULT marker is a status badge. List = TanStack Virtual over a scroll
 * container (project rule — never FlatList/FlashList). All view state lives in
 * Zustand (`payment-methods-ui-store`) — never useState.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { CreditCard, Plus, Star, Trash2, AlertCircle, X } from "lucide-react";
import { Dialog } from "@dvnt/ui";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { paymentMethodsApi } from "@dvnt/app/lib/api/payments";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { usePaymentMethodsUIStore } from "@dvnt/app/lib/stores/payment-methods-ui-store";
import type { PaymentMethod } from "@dvnt/app/lib/types/payments";

const BRAND_COLORS: Record<string, string> = {
  visa: "#1A1F71",
  mastercard: "#EB001B",
  amex: "#006FCF",
  discover: "#FF6000",
};

const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
};

const ROW_HEIGHT = 88; // 76px card + 12px gap

const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
  "";

let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = STRIPE_PUBLISHABLE_KEY
      ? loadStripe(STRIPE_PUBLISHABLE_KEY)
      : Promise.resolve(null);
  }
  return stripePromise;
}

function PaymentMethodRow({
  method,
  onSetDefault,
  onRemove,
  isSettingDefault,
}: {
  method: PaymentMethod;
  onSetDefault: () => void;
  onRemove: () => void;
  isSettingDefault: boolean;
}) {
  const brand = method.card?.brand || "card";
  const brandColor = BRAND_COLORS[brand] || "#666";
  const brandLabel = BRAND_LABELS[brand] || "Card";

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/4 p-4">
      {/* Brand tile — rounded square, never circular, never a pill */}
      <div
        className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${brandColor}33` }}
      >
        <CreditCard size={20} color={brandColor} />
      </div>

      {/* Card info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-white">
            {brandLabel} ••{method.card?.last4 || "****"}
          </p>
          {method.isDefault ? (
            <span className="shrink-0 rounded-md bg-cyan-400/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-cyan-400">
              DEFAULT
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-white/60">
          Expires {method.card?.expMonth}/{method.card?.expYear}
          {method.card?.funding === "debit" ? " • Debit" : ""}
        </p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        {!method.isDefault ? (
          <button
            type="button"
            onClick={onSetDefault}
            disabled={isSettingDefault}
            aria-label="Set as default"
            title="Set as default"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 transition-colors active:bg-white/12 disabled:opacity-50"
          >
            {isSettingDefault ? (
              <span className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-amber-400 animate-spin" />
            ) : (
              <Star size={16} color="#EAB308" />
            )}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          title="Remove"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 transition-colors active:bg-rose-500/20"
        >
          <Trash2 size={16} color="#EF4444" />
        </button>
      </div>
    </div>
  );
}

/** Inner form rendered inside <Elements> — drives Stripe confirmSetup. */
function AddCardForm({ onAdded }: { onAdded: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const showToast = useUIStore((s) => s.showToast);
  const {
    isConfirmingAdd,
    addError,
    setIsConfirmingAdd,
    setAddError,
    closeAdd,
  } = usePaymentMethodsUIStore();

  const handleConfirm = async () => {
    if (!stripe || !elements) return;
    setIsConfirmingAdd(true);
    setAddError(null);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setAddError(submitError.message || "Please check your card details");
        return;
      }
      const { error } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });
      if (error) {
        setAddError(error.message || "Failed to add card");
        return;
      }
      // Success — mirror native: toast + refresh list.
      showToast("success", "Added", "Payment method saved");
      closeAdd();
      onAdded();
    } catch (err: any) {
      setAddError(err?.message || "Something went wrong");
    } finally {
      setIsConfirmingAdd(false);
    }
  };

  return (
    <div>
      <div className="rounded-xl border border-white/10 bg-white/6 p-4">
        <PaymentElement />
      </div>
      {addError ? (
        <p className="mt-3 text-sm text-rose-400">{addError}</p>
      ) : null}
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={isConfirmingAdd}
          onClick={closeAdd}
          className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={isConfirmingAdd || !stripe || !elements}
          onClick={handleConfirm}
          className="flex-1 rounded-xl bg-cyan-400 py-3 font-semibold text-black disabled:opacity-50"
        >
          {isConfirmingAdd ? "Saving…" : "Add Card"}
        </button>
      </div>
    </div>
  );
}

export function PaymentMethodsScreen() {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);

  const {
    methods,
    isLoading,
    error,
    setMethods,
    setLoading,
    setError,
    removeMethod,
    setDefault,
  } = usePaymentsStore();

  const {
    addOpen,
    isStartingSetup,
    setupClientSecret,
    removeTarget,
    isRemoving,
    settingDefaultId,
    openAdd,
    closeAdd,
    setIsStartingSetup,
    setSetupClientSecret,
    setAddError,
    openRemove,
    closeRemove,
    setIsRemoving,
    setSettingDefaultId,
  } = usePaymentMethodsUIStore();

  const loadMethods = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await paymentMethodsApi.list();
      setMethods(result);
    } catch (err: any) {
      setError(err?.message || "Failed to load payment methods");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMethods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Add-card: same server mutation native calls (createSetupIntent), then drive
  // Stripe Elements web-safely in the Dialog instead of the native PaymentSheet.
  const handleAddPaymentMethod = async () => {
    openAdd();
    setIsStartingSetup(true);
    try {
      const setup = await paymentMethodsApi.createSetupIntent();
      if (setup.error || !setup.clientSecret) {
        setAddError(setup.error || "Failed to start setup");
        return;
      }
      setSetupClientSecret(setup.clientSecret);
    } catch (err: any) {
      setAddError(err?.message || "Something went wrong");
    } finally {
      setIsStartingSetup(false);
    }
  };

  const handleSetDefault = async (method: PaymentMethod) => {
    setSettingDefaultId(method.id);
    setDefault(method.id); // optimistic — mirrors native
    const result = await paymentMethodsApi.setDefault(method.id);
    if (!result.success) {
      showToast("error", "Error", result.error || "Failed to set default");
      loadMethods();
    }
    setSettingDefaultId(null);
  };

  const handleConfirmRemove = async () => {
    const method = removeTarget;
    if (!method) return;
    setIsRemoving(true);
    removeMethod(method.id); // optimistic — mirrors native
    const result = await paymentMethodsApi.remove(method.id);
    if (!result.success) {
      showToast("error", "Error", result.error || "Failed to remove");
      loadMethods();
    } else {
      showToast("success", "Removed", "Payment method removed");
    }
    closeRemove();
  };

  // ── Virtualized list ──
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: methods.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const showLoading = isLoading && methods.length === 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header — sticky; Add (+) + close X mirror native headerRight */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Payment Methods</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAddPaymentMethod}
            disabled={isStartingSetup}
            aria-label="Add payment method"
            className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 disabled:opacity-50"
          >
            {isStartingSetup ? (
              <span className="inline-block h-5 w-5 rounded-full border-2 border-white/30 border-t-cyan-400 animate-spin" />
            ) : (
              <Plus size={22} color="#3FDCFF" />
            )}
          </button>
          <button
            onClick={() => router.back()}
            aria-label="Close"
            className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
          >
            <X size={18} color="#fff" />
          </button>
        </div>
      </div>

      {showLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
          <p className="mt-4 text-sm text-white/60">Loading payment methods…</p>
        </div>
      ) : error ? (
        <main className="mx-auto w-full max-w-2xl px-8 py-24">
          <div className="flex flex-col items-center justify-center text-center">
            <AlertCircle size={48} color="rgba(239,68,68,0.5)" />
            <p className="mt-3 font-semibold text-white">Failed to load</p>
            <p className="mt-1 text-sm text-white/60">{error}</p>
            <button
              onClick={loadMethods}
              className="mt-4 rounded-xl bg-cyan-400/10 px-5 py-2.5 font-semibold text-cyan-400 active:bg-cyan-400/20"
            >
              Retry
            </button>
          </div>
        </main>
      ) : methods.length === 0 ? (
        <main className="mx-auto w-full max-w-2xl px-8 py-24">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/6">
              <CreditCard size={48} color="#666" />
            </div>
            <p className="mb-2 text-lg font-semibold text-white">
              No payment methods
            </p>
            <p className="text-sm text-white/60">
              Add a card to speed up checkout, or one is saved automatically when
              you purchase tickets.
            </p>
            <button
              onClick={handleAddPaymentMethod}
              disabled={isStartingSetup}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-2.5 font-semibold text-black disabled:opacity-50"
            >
              <Plus size={18} color="#000" />
              Add Card
            </button>
          </div>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-2xl px-4 py-6">
          <p className="mb-3 text-sm font-medium uppercase tracking-wide text-white/60">
            {methods.length} SAVED{" "}
            {methods.length === 1 ? "METHOD" : "METHODS"}
          </p>
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 200px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const method = methods[item.index];
                if (!method) return null;
                return (
                  <div
                    key={method.id}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                      paddingBottom: 12,
                    }}
                  >
                    <PaymentMethodRow
                      method={method}
                      onSetDefault={() => handleSetDefault(method)}
                      onRemove={() => openRemove(method)}
                      isSettingDefault={settingDefaultId === method.id}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      )}

      {/* Add-card — kit Dialog driving Stripe Elements (web-safe PaymentSheet). */}
      <Dialog
        open={addOpen}
        onClose={() => {
          if (!usePaymentMethodsUIStore.getState().isConfirmingAdd) closeAdd();
        }}
        title="Add Card"
      >
        {isStartingSetup ? (
          <div className="flex flex-col items-center justify-center py-10">
            <div className="w-7 h-7 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
            <p className="mt-3 text-sm text-white/60">Preparing secure form…</p>
          </div>
        ) : !STRIPE_PUBLISHABLE_KEY ? (
          <p className="py-6 text-sm text-rose-400">
            Stripe is not configured. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to
            add cards on web.
          </p>
        ) : setupClientSecret ? (
          <Elements
            stripe={getStripePromise()}
            options={{
              clientSecret: setupClientSecret,
              appearance: { theme: "night", labels: "floating" },
            }}
          >
            <AddCardForm onAdded={loadMethods} />
          </Elements>
        ) : (
          <p className="py-6 text-sm text-white/60">
            Could not start the add-card flow. Please try again.
          </p>
        )}
      </Dialog>

      {/* Remove confirmation — kit Dialog mirroring native Alert.alert. */}
      <Dialog
        open={removeTarget !== null}
        onClose={() => {
          if (!isRemoving) closeRemove();
        }}
        title="Remove Payment Method"
        footer={
          <>
            <button
              disabled={isRemoving}
              onClick={closeRemove}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={isRemoving}
              onClick={handleConfirmRemove}
              className="flex-1 rounded-xl bg-rose-500 py-3 font-semibold text-white disabled:opacity-50"
            >
              {isRemoving ? "Removing…" : "Remove"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          Remove{" "}
          {BRAND_LABELS[removeTarget?.card?.brand || ""] || "this card"} ending
          in {removeTarget?.card?.last4 || "****"}?
        </p>
      </Dialog>
    </div>
  );
}

export default PaymentMethodsScreen;
