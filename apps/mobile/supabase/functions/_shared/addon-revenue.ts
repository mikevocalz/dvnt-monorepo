/**
 * Kept revenue of one public.order_addons row, in cents.
 *
 * Same formula recompute_event_financials uses (migration
 * 20261009020000_event_financials_addon_revenue.sql): a row whose status is
 * 'refunded' keeps nothing; any other row keeps unit_price_cents * quantity
 * minus refunded_amount_cents, clamped at zero.
 */
export const ADDON_REVENUE_SELECT =
  "event_id, status, unit_price_cents, quantity, refunded_amount_cents, created_at";

export interface AddonRevenueRow {
  status?: string | null;
  unit_price_cents?: number | null;
  quantity?: number | null;
  refunded_amount_cents?: number | null;
}

export function addonKeptCents(row: AddonRevenueRow): number {
  if (row.status === "refunded") return 0;
  const line = Number(row.unit_price_cents || 0) * Number(row.quantity || 0);
  return Math.max(0, line - Number(row.refunded_amount_cents || 0));
}
