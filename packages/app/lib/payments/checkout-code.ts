/** The code field accepts two distinct payment policies, never two promo rows. */
import type { PromoDiscountType } from "./promo-discount";
export interface CheckoutPromo { type: PromoDiscountType; value: number; code: string }
export type CheckoutCodeResult =
  | { kind: "promo"; promo: CheckoutPromo }
  | { kind: "promoter"; code: string; customerDiscountBps: number }
  | { kind: "error"; message: string };
export function readCheckoutCodeResult(value: unknown): CheckoutCodeResult {
  const invalid = { kind: "error" as const, message: "Could not validate this code. Please try again." };
  if (!value || typeof value !== "object") return invalid;
  const data = value as Record<string, unknown>;
  if (data.valid !== true) return { kind: "error", message:
    typeof data.error === "string" ? data.error : invalid.message };
  if (typeof data.code !== "string" || !data.code.trim()) return invalid;
  if (data.code_kind === "promoter") {
    const bps = data.customer_discount_bps;
    if (!Number.isInteger(bps) || Number(bps) < 0 || Number(bps) > 10000) return invalid;
    return { kind: "promoter", code: data.code, customerDiscountBps: Number(bps) };
  }
  if (data.code_kind != null && data.code_kind !== "promo") return invalid;
  if (!["percent", "fixed_cents", "bogo"].includes(String(data.discount_type)) ||
      typeof data.discount_value !== "number" || !Number.isFinite(data.discount_value) || data.discount_value < 0)
    return invalid;
  return { kind: "promo", promo: { code: data.code,
    type: data.discount_type as PromoDiscountType, value: data.discount_value } };
}
/** A failed/edited/unapplied code must not silently become a full-price payment. */
export function canContinueWithCheckoutCode(code: string, promo: CheckoutPromo | null,
  applying: boolean, error: string | null): boolean {
  if (applying) return false;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return true;
  return !error && !!promo && normalized === promo.code.trim().toUpperCase();
}
