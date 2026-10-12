/** Guest quotes and charges share the existing DVNT discount and fee policies. */
import { computeFeesWithMode, MIN_TIER_PRICE_CENTS, type ModedFeeBreakdown } from "./fee-calculator.ts";
import { validateAndApplyPromo, type PromoResult } from "./apply-promo-code.ts";
import { escapeLikePattern, validateAndApplyPromoterCode, type PromoterCodeResult } from "./apply-promoter-code.ts";

export const GUEST_PRICING_VERSION = "guest-discounts-v1";
export interface GuestQuote {
  pricing_version: typeof GUEST_PRICING_VERSION;
  quote_key: string;
  subtotal_cents: number;
  discount_cents: number;
  net_subtotal_cents: number;
  buyer_fee_cents: number;
  total_cents: number;
  currency: "USD";
  promo_code: string | null;
  promoter_code: string | null;
  manual_code: string;
  code_kind: "promo" | "promoter" | null;
}
export interface GuestPriceInput {
  eventId: number;
  tierId: string;
  unitPriceCents: number;
  quantity: number;
  feeMode?: string | null;
  guestEmail: string;
  discountCode?: unknown;
  promoCode?: unknown;
  promoterCode?: unknown;
}
export class GuestPriceError extends Error {}
function normalizeCode(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > 64 || /[\x00-\x1f\x7f]/.test(value))
    throw new GuestPriceError("Enter a valid promo or promoter code.");
  return value.trim().toUpperCase();
}

export async function priceGuestCheckout(db: any, input: GuestPriceInput): Promise<{
  quote: GuestQuote;
  fees: ModedFeeBreakdown | null;
  promo: PromoResult | null;
  promoter: PromoterCodeResult | null;
  orderFields: Record<string, unknown>;
  metadata: Record<string, string>;
}> {
  const { eventId, tierId, quantity, unitPriceCents, guestEmail } = input;
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 ||
      !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10 ||
      !Number.isSafeInteger(unitPriceCents * quantity))
    throw new GuestPriceError("The ticket price or quantity is invalid. Reload the event.");
  const explicitPromo = normalizeCode(input.promoCode);
  const manualCode = normalizeCode(input.discountCode) || explicitPromo;
  if (explicitPromo && normalizeCode(input.discountCode) && explicitPromo !== manualCode)
    throw new GuestPriceError("Apply one promo code at a time.");
  let promoterCode = normalizeCode(input.promoterCode);
  let promoCode = explicitPromo;
  let codeKind: GuestQuote["code_kind"] = explicitPromo ? "promo" : null;

  // A single visible field accepts both existing code types. An exact promo
  // match takes precedence; an expired/wrong-tier promo never falls through to
  // a different discount. A manually entered promoter replaces the tracked ref.
  if (manualCode && !explicitPromo) {
    const matches = await db.from("promo_codes").select("id")
      .eq("event_id", eventId).is("deleted_at", null)
      .ilike("code", escapeLikePattern(manualCode));
    if (matches.error) throw new GuestPriceError("Could not check the code. Please try again.");
    if (matches.data?.length) { promoCode = manualCode; codeKind = "promo"; }
    else { promoterCode = manualCode; codeKind = "promoter"; }
  }

  const rawSubtotal = unitPriceCents * quantity;
  let promoter: PromoterCodeResult | null = null;
  let promo: PromoResult | null = null;
  if (promoterCode) {
    const applied = await validateAndApplyPromoterCode(db, eventId, promoterCode, rawSubtotal, quantity);
    if (applied.error || !applied.result)
      throw new GuestPriceError(codeKind === "promoter"
        ? "That promo or promoter code is invalid or no longer active."
        : "The promoter code from your link is no longer active. Remove it or enter another code.");
    promoter = applied.result;
  }
  const afterPromoter = Math.max(0, rawSubtotal - (promoter?.discount_cents ?? 0));
  if (promoCode) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail))
      throw new GuestPriceError("Enter your email before applying a promo code.");
    const applied = await validateAndApplyPromo(db, eventId, promoCode, tierId, afterPromoter,
      { quantity, guestEmail });
    if (applied.error || !applied.result)
      throw new GuestPriceError(applied.error || "Invalid promo code.");
    promo = applied.result;
  }
  const discount = (promoter?.discount_cents ?? 0) + (promo?.discount_cents ?? 0);
  if (!Number.isSafeInteger(discount) || discount < 0 || discount > rawSubtotal)
    throw new GuestPriceError("This code has an invalid discount. Contact the organizer.");
  const netSubtotal = rawSubtotal - discount;
  let fees: ModedFeeBreakdown | null = null;
  if (netSubtotal > 0) {
    if (unitPriceCents < MIN_TIER_PRICE_CENTS)
      throw new GuestPriceError("This ticket is priced below the minimum for fees.");
    try { fees = computeFeesWithMode(netSubtotal, quantity, input.feeMode); }
    catch { throw new GuestPriceError("This discount leaves too little to cover ticket fees. Try another code."); }
  }
  const quote: GuestQuote = {
    pricing_version: GUEST_PRICING_VERSION, quote_key: "", subtotal_cents: rawSubtotal,
    discount_cents: discount, net_subtotal_cents: netSubtotal,
    buyer_fee_cents: fees?.buyer_fee ?? 0, total_cents: fees?.customer_charge_amount ?? 0,
    currency: "USD", promo_code: promo?.code ?? null, promoter_code: promoter?.code ?? null,
    manual_code: manualCode, code_kind: codeKind,
  };
  // A review fingerprint, NOT a client authorization token. Checkout recomputes
  // everything from the database and refuses a changed reviewed quote.
  const canonical = JSON.stringify({ eventId, tierId, quantity, guestEmail,
    quote, feeMode: fees?.fee_mode ?? "free", promoId: promo?.promo_code_id ?? null,
    promoterId: promoter?.promoter_id ?? null });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  quote.quote_key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const orderFields: Record<string, unknown> = {
    ...(promo ? { promo_code_id: promo.promo_code_id } : {}),
    ...(discount > 0 ? { discount_cents: discount } : {}),
    ...(promoter ? {
      ...(netSubtotal === 0 ? { promoter_id: promoter.promoter_id } : {}),
      promoter_policy_version: "v2_eligible_subtotal_after_discount",
      promoter_original_amount_cents: rawSubtotal,
      promoter_customer_discount_bps: promoter.customer_discount_bps,
      promoter_discount_amount_cents: promoter.discount_cents,
      promoter_discounted_amount_cents: promoter.discounted_amount_cents,
      promoter_code: promoter.code,
      promoter_commission_bps: promoter.promoter_commission_bps,
      // Free orders cannot create a payable earning, even when a normal
      // promo removes the subtotal remaining after the promoter discount.
      promoter_commission_amount_cents: netSubtotal === 0 ? 0 : promoter.commission_cents,
    } : {}),
  };
  const metadata: Record<string, string> = {
    subtotal_cents: String(netSubtotal), buyer_fee_cents: String(quote.buyer_fee_cents),
    discount_cents: String(discount), guest_pricing_version: GUEST_PRICING_VERSION,
    ...(promo ? { promo_code_id: promo.promo_code_id, promo_code: promo.code } : {}),
    ...(promoter ? { dvnt_promoter_code: promoter.code } : {}),
  };
  return { quote, fees, promo, promoter, orderFields, metadata };
}
