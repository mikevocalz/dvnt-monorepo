"use client";

/**
 * Checkout — Review Order — WEB (@dvnt/app/features/events/checkout-review).
 * Phase port of native `app/(protected)/checkout/review.tsx`. Law 1 (data is
 * sacred): identical data flow. Cart/order state from the SHARED `useCartStore`
 * (cart, updateLineItemQuantity, removeLineItem, clearCart); checkout loading
 * from the SHARED `usePaymentsStore`. The place-order mutation is the EXACT
 * native flow — `cartApi.createHold(cart)` then `cartApi.checkout(cartId)` —
 * which returns a Stripe PaymentIntent (clientSecret + publishableKey).
 *
 * PAYMENT: native uses @stripe/stripe-react-native's PaymentSheet, which is
 * native-only. On web we run the SAME createHold + checkout mutations to mint
 * the PaymentIntent, then confirm the returned `clientSecret` with the web-safe
 * `@stripe/stripe-js` SDK (NO @stripe/stripe-react-native import). Success →
 * /feed/checkout/success.
 *
 * Price breakdown (subtotal · DVNT service fee · tax · total) is the SAME
 * `computeFees` / `calculateCartSubtotalCents` math native uses. Promo code is a
 * tiny local Zustand store (no useState). Law 3: raw semantic HTML + Tailwind
 * (NativeWind interop off); kit FormField for the promo input; rounded squares
 * only; bg #06070d, accent cyan #3FDCFF.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useRouter } from "solito/navigation";
import { create } from "zustand";
import { loadStripe } from "@stripe/stripe-js";
import {
  ArrowLeft,
  CreditCard,
  Minus,
  Plus,
  Shirt,
  ShoppingBag,
  Tag,
  Ticket,
  Trash2,
} from "lucide-react";
import { FormField } from "@dvnt/ui";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";
import type {
  CartLineItem,
  LineItemCategory,
} from "@dvnt/app/lib/contracts/dto";
import { calculateCartSubtotalCents } from "@dvnt/app/lib/contracts/invariants";
import { computeFees, formatCents } from "@dvnt/app/lib/stripe/fee-calculator";
import { cartApi } from "@dvnt/app/lib/api/cart";
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";
import {
  computePromoDiscountCents,
  promoLabel,
} from "@dvnt/app/lib/payments/promo-discount";
import { useCartStore } from "@dvnt/app/lib/stores/cart";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

// ── Promo input: tiny local Zustand store (no useState, Law 2) ──────────
type AppliedPromo = {
  type: "percent" | "fixed_cents" | "bogo";
  value: number;
  code: string;
};
interface PromoState {
  promoCode: string;
  setPromoCode: (value: string) => void;
  appliedPromo: AppliedPromo | null;
  setAppliedPromo: (p: AppliedPromo | null) => void;
  promoError: string | null;
  setPromoError: (e: string | null) => void;
  promoApplying: boolean;
  setPromoApplying: (v: boolean) => void;
}
const usePromoStore = create<PromoState>((set) => ({
  promoCode: "",
  setPromoCode: (promoCode) => set({ promoCode }),
  appliedPromo: null,
  setAppliedPromo: (appliedPromo) => set({ appliedPromo }),
  promoError: null,
  setPromoError: (promoError) => set({ promoError }),
  promoApplying: false,
  setPromoApplying: (promoApplying) => set({ promoApplying }),
}));

const CATEGORY_LABELS: Record<LineItemCategory, string> = {
  admission: "Admission",
  coat_check: "Coat Check",
  product: "Merch",
  service: "Service",
  addon: "Add-on",
};

function metadataText(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function CategoryIcon({
  category,
  className,
}: {
  category: LineItemCategory;
  className?: string;
}) {
  if (category === "coat_check") return <Shirt size={18} className={className} />;
  return <Ticket size={18} className={className} />;
}

function LineItemRow({
  lineItem,
  onIncrement,
  onDecrement,
  onRemove,
}: {
  lineItem: CartLineItem;
  onIncrement: (lineItem: CartLineItem) => void;
  onDecrement: (lineItem: CartLineItem) => void;
  onRemove: (lineItem: CartLineItem) => void;
}) {
  const title = metadataText(
    lineItem.metadata,
    ["tierName", "name", "title"],
    CATEGORY_LABELS[lineItem.category],
  );
  const eventTitle = metadataText(lineItem.metadata, ["eventTitle"], "");
  const lineTotalCents = lineItem.unitPriceCents * lineItem.quantity;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#3FDCFF]/15">
        <CategoryIcon category={lineItem.category} className="text-[#3FDCFF]" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold text-white">{title}</p>
        {eventTitle ? (
          <p className="truncate text-xs text-white/55">{eventTitle}</p>
        ) : null}
        <p className="mt-1 text-xs text-white/40">
          {formatCents(lineItem.unitPriceCents)} each
        </p>
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onDecrement(lineItem)}
            aria-label={`Decrease ${title} quantity`}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 active:scale-95 disabled:opacity-40"
          >
            <Minus
              size={14}
              className={lineItem.quantity <= 1 ? "text-white/40" : "text-white"}
            />
          </button>
          <span className="min-w-[20px] text-center text-sm font-bold text-white">
            {lineItem.quantity}
          </span>
          <button
            type="button"
            onClick={() => onIncrement(lineItem)}
            aria-label={`Increase ${title} quantity`}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 active:scale-95"
          >
            <Plus size={14} className="text-white" />
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-sm font-bold text-white">
            {formatCents(lineTotalCents)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(lineItem)}
            aria-label={`Remove ${title}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg active:scale-95"
          >
            <Trash2 size={16} className="text-rose-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function CheckoutReviewScreen() {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);

  const cart = useCartStore((state) => state.cart);
  const updateLineItemQuantity = useCartStore(
    (state) => state.updateLineItemQuantity,
  );
  const removeLineItem = useCartStore((state) => state.removeLineItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const setHold = useCartStore((state) => state.setHold);
  const setPaymentIntent = useCartStore((state) => state.setPaymentIntent);

  const isLoading = usePaymentsStore((state) => state.checkoutLoading);
  const setCheckoutLoading = usePaymentsStore(
    (state) => state.setCheckoutLoading,
  );

  const promoCode = usePromoStore((s) => s.promoCode);
  const setPromoCode = usePromoStore((s) => s.setPromoCode);
  const appliedPromo = usePromoStore((s) => s.appliedPromo);
  const setAppliedPromo = usePromoStore((s) => s.setAppliedPromo);
  const promoError = usePromoStore((s) => s.promoError);
  const setPromoError = usePromoStore((s) => s.setPromoError);
  const promoApplying = usePromoStore((s) => s.promoApplying);
  const setPromoApplying = usePromoStore((s) => s.setPromoApplying);

  const lineItems = cart?.lineItems ?? [];

  const groups = useMemo(() => {
    const categories: LineItemCategory[] = ["admission", "coat_check"];
    return categories
      .map((category) => ({
        category,
        title: CATEGORY_LABELS[category],
        lines: lineItems.filter((lineItem) => lineItem.category === category),
      }))
      .filter((group) => group.lines.length > 0);
  }, [lineItems]);

  const subtotalCents = useMemo(
    () => calculateCartSubtotalCents(lineItems),
    [lineItems],
  );
  const quantity = useMemo(
    () => lineItems.reduce((sum, lineItem) => sum + lineItem.quantity, 0),
    [lineItems],
  );
  // Promo discount preview (server re-validates + is authoritative at charge).
  // BOGO depends on qty, so recompute from the validated promo each change.
  const discountCents = useMemo(
    () =>
      appliedPromo
        ? computePromoDiscountCents(
            appliedPromo.type,
            appliedPromo.value,
            subtotalCents,
            quantity,
          )
        : 0,
    [appliedPromo, subtotalCents, quantity],
  );
  const effectiveSubtotal = Math.max(0, subtotalCents - discountCents);
  const fees = useMemo(
    () =>
      quantity > 0
        ? computeFees(effectiveSubtotal, quantity)
        : { buyer_fee: 0, customer_charge_amount: 0 },
    [quantity, effectiveSubtotal],
  );

  // Drop a validated promo when the buyer edits the code away from it.
  useEffect(() => {
    if (
      appliedPromo &&
      promoCode.trim().toUpperCase() !== appliedPromo.code.toUpperCase()
    ) {
      setAppliedPromo(null);
      setPromoError(null);
    }
  }, [promoCode, appliedPromo, setAppliedPromo, setPromoError]);

  const handleApplyPromo = useCallback(async () => {
    const code = promoCode.trim();
    if (!code) {
      setPromoError("Enter a promo code");
      return;
    }
    if (!cart) return;
    setPromoApplying(true);
    setPromoError(null);
    const { data, error } = await invokeEdge<{
      valid: boolean;
      discount_type?: "percent" | "fixed_cents" | "bogo";
      discount_value?: number;
      code?: string;
      error?: string;
    }>("validate-promo-code", { event_id: Number(cart.eventId), code });
    setPromoApplying(false);
    if (error || !data?.valid || !data.discount_type) {
      setAppliedPromo(null);
      setPromoError(data?.error || error?.message || "Invalid promo code");
      return;
    }
    setAppliedPromo({
      type: data.discount_type,
      value: data.discount_value ?? 0,
      code: data.code || code,
    });
  }, [promoCode, cart, setAppliedPromo, setPromoError, setPromoApplying]);

  const handleIncrement = useCallback(
    (lineItem: CartLineItem) => {
      updateLineItemQuantity(lineItem.lineItemId, lineItem.quantity + 1);
    },
    [updateLineItemQuantity],
  );

  const handleDecrement = useCallback(
    (lineItem: CartLineItem) => {
      if (lineItem.quantity <= 1) {
        showToast("info", "Use remove to delete this item");
        return;
      }
      updateLineItemQuantity(lineItem.lineItemId, lineItem.quantity - 1);
    },
    [updateLineItemQuantity, showToast],
  );

  const handleRemove = useCallback(
    (lineItem: CartLineItem) => {
      removeLineItem(lineItem.lineItemId);
      showToast("success", "Removed from cart");
    },
    [removeLineItem, showToast],
  );

  const handleClearCart = useCallback(() => {
    clearCart();
    showToast("success", "Cart cleared");
  }, [clearCart, showToast]);

  // Place-order: EXACT native mutation flow (createHold → checkout), then
  // confirm the returned Stripe PaymentIntent client secret on the web with
  // @stripe/stripe-js (web-safe; no @stripe/stripe-react-native).
  const handlePlaceOrder = useCallback(async () => {
    if (!cart || lineItems.length === 0) {
      showToast("error", "Your cart is empty");
      return;
    }

    setCheckoutLoading(true);
    AppTrace.trace("CART", "cart_review_continue_pressed", {
      cartId: cart.cartId,
      lineItems: lineItems.length,
      totalCents: fees.customer_charge_amount,
    });

    try {
      const hold = await cartApi.createHold(cart);
      const holdExpiresAt = Date.parse(hold.holdExpiresAt);
      if (!Number.isFinite(holdExpiresAt)) {
        throw new Error("Could not verify cart hold");
      }
      setHold(holdExpiresAt);

      const payment = await cartApi.checkout(
        cart.cartId,
        appliedPromo ? appliedPromo.code : undefined,
      );
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

      const stripe = await loadStripe(payment.publishableKey);
      if (!stripe) throw new Error("Failed to initialize payment");

      const { error: confirmError } = await stripe.confirmCardPayment(
        payment.clientSecret,
      );
      if (confirmError) {
        AppTrace.error("CART", "mixed_cart_payment_sheet_failed", {
          cartId: cart.cartId,
          paymentIntentId: payment.paymentIntentId,
          error: confirmError.message,
        });
        throw new Error(confirmError.message || "Payment failed");
      }

      AppTrace.trace("CART", "mixed_cart_payment_sheet_succeeded", {
        cartId: cart.cartId,
        paymentIntentId: payment.paymentIntentId,
      });
      showToast("success", "Payment received");
      router.replace("/feed/checkout/success");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Checkout failed";
      AppTrace.error("CART", "mixed_cart_checkout_failed", {
        cartId: cart.cartId,
        error: message,
      });
      showToast("error", message);
    } finally {
      setCheckoutLoading(false);
    }
  }, [
    cart,
    lineItems.length,
    fees.customer_charge_amount,
    appliedPromo,
    router,
    setCheckoutLoading,
    setHold,
    setPaymentIntent,
    showToast,
  ]);

  const holdLabel =
    cart?.holdExpiresAt && cart.holdExpiresAt > Date.now()
      ? `Reserved until ${new Date(cart.holdExpiresAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}`
      : "No active hold";

  const isEmpty = lineItems.length === 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header — "Review Order" */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <ArrowLeft size={20} className="text-white" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold leading-tight">Review Order</h1>
          <p className="text-xs text-white/55">{holdLabel}</p>
        </div>
        <button
          type="button"
          onClick={handleClearCart}
          aria-label="Clear cart"
          disabled={isEmpty}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95 disabled:opacity-40"
        >
          <Trash2 size={18} className={isEmpty ? "text-white/30" : "text-rose-400"} />
        </button>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#3FDCFF]/15">
              <ShoppingBag size={32} className="text-[#3FDCFF]" />
            </div>
            <p className="text-xl font-bold text-white">Your cart is empty</p>
            <p className="mt-2 text-sm leading-5 text-white/55">
              Add admission tickets or coat-check passes from an event.
            </p>
          </div>
        ) : (
          <>
            {/* Order summary — grouped line items */}
            {groups.map((group) => (
              <section key={group.category} className="mb-5">
                <div className="mb-2 flex items-center gap-2">
                  <CategoryIcon
                    category={group.category}
                    className="text-[#3FDCFF]"
                  />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-white/55">
                    {group.title}
                  </h2>
                </div>
                <div className="flex flex-col gap-2.5">
                  {group.lines.map((lineItem) => (
                    <LineItemRow
                      key={lineItem.lineItemId}
                      lineItem={lineItem}
                      onIncrement={handleIncrement}
                      onDecrement={handleDecrement}
                      onRemove={handleRemove}
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* Promo code */}
            <section className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <FormField label="Promo code">
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-3 h-11">
                    <Tag size={18} className="shrink-0 text-white/40" />
                    <input
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      placeholder="Enter code"
                      autoCapitalize="characters"
                      className="w-full bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyPromo}
                    disabled={promoApplying || !promoCode.trim()}
                    className="h-11 shrink-0 rounded-xl border border-[#3FDCFF]/40 bg-[#3FDCFF]/10 px-4 text-sm font-semibold text-[#3FDCFF] active:scale-95 disabled:opacity-40"
                  >
                    {promoApplying ? "…" : appliedPromo ? "Applied" : "Apply"}
                  </button>
                </div>
              </FormField>
              {promoError ? (
                <p className="mt-2 text-sm text-[#FC253A]">{promoError}</p>
              ) : appliedPromo ? (
                <p className="mt-2 text-sm text-[#3FDCFF]">
                  {promoLabel(appliedPromo.type, appliedPromo.value)} applied
                </p>
              ) : null}
            </section>

            {/* Price breakdown */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-white/55">Subtotal</span>
                <span className="text-sm font-semibold text-white/90">
                  {formatCents(subtotalCents)}
                </span>
              </div>
              {discountCents > 0 && appliedPromo ? (
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-[#3FDCFF]">
                    {promoLabel(appliedPromo.type, appliedPromo.value)}
                  </span>
                  <span className="text-sm font-semibold text-[#3FDCFF]">
                    −{formatCents(discountCents)}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-white/55">DVNT Service Fee</span>
                <span className="text-sm font-semibold text-white/90">
                  {formatCents(fees.buyer_fee)}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-white/55">Tax</span>
                <span className="text-sm font-semibold text-white/90">
                  {formatCents(0)}
                </span>
              </div>
              <div className="my-2 h-px bg-white/12" />
              <div className="flex items-center justify-between py-1">
                <span className="text-base font-extrabold text-white">Total</span>
                <span className="text-xl font-extrabold text-white">
                  {formatCents(fees.customer_charge_amount)}
                </span>
              </div>

              {/* Place order */}
              <button
                type="button"
                onClick={handlePlaceOrder}
                disabled={isEmpty || isLoading}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-[#3FDCFF] text-[#06070d] active:scale-[0.99] disabled:opacity-45"
              >
                <CreditCard size={18} className="text-[#06070d]" />
                <span className="text-[15px] font-extrabold">
                  {isLoading ? "Processing…" : "Pay"}
                </span>
              </button>

              {/* Terms */}
              <p className="mt-3 text-center text-xs leading-5 text-white/45">
                By placing this order you agree to DVNT&apos;s Terms of Service.
                Service fees are non-refundable.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
