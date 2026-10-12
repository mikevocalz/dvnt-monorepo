/** Browser contract only: never import payment/server modules into the client. */
export interface GuestCheckoutQuote {
  pricing_version: "guest-discounts-v1";
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
export interface GuestQuoteSelection {
  requestKey: string; eventId: string; tierId: string; quantity: number;
  email: string; discountCode: string; trackedPromoterCode: string; quoteRevision: number;
}
export const normalizeGuestCode = (value: string) => value.trim().toUpperCase();
export function guestQuoteSelectionKey(s: GuestQuoteSelection): string {
  return JSON.stringify([s.requestKey, s.eventId, s.tierId, s.quantity,
    s.email.trim().toLowerCase(), s.discountCode, s.trackedPromoterCode, s.quoteRevision]);
}
export function isGuestCheckoutQuote(q: unknown): q is GuestCheckoutQuote {
  if (!q || typeof q !== "object") return false;
  const v = q as GuestCheckoutQuote;
  return v.pricing_version === "guest-discounts-v1" && /^[a-f0-9]{64}$/.test(v.quote_key) &&
    v.currency === "USD" && typeof v.manual_code === "string" &&
    [v.subtotal_cents, v.discount_cents, v.net_subtotal_cents, v.buyer_fee_cents, v.total_cents]
      .every(n => Number.isSafeInteger(n) && n >= 0) &&
    v.subtotal_cents - v.discount_cents === v.net_subtotal_cents &&
    v.net_subtotal_cents + v.buyer_fee_cents === v.total_cents;
}
export function guestQuoteReady(s: GuestQuoteSelection & {
  quote: GuestCheckoutQuote | null; quoteSelectionKey: string;
  quoteLoading: boolean; quoteError: string | null; codeDraft: string;
}): boolean {
  return !!s.quote && !s.quoteLoading && !s.quoteError &&
    s.quoteSelectionKey === guestQuoteSelectionKey(s) &&
    normalizeGuestCode(s.codeDraft) === s.discountCode;
}
