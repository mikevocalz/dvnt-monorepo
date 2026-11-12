import type { PromoterPayoutRow } from "./promoter-payout-summary.ts";

export type LinkedPromoterPayoutRow = PromoterPayoutRow & {
  id: string;
  order_id: string;
  currency: string;
  external_settlement_id: string | null;
  order: { id: string; charge_model: string | null } | null;
};

/** Partition by immutable payment rail, never by whether a v2 summary is empty.
 * Reversals follow their source order. A missing join is not evidence of legacy.
 */
export function legacyPromoterRows(rows: LinkedPromoterPayoutRow[]): PromoterPayoutRow[] | null {
  const legacy: PromoterPayoutRow[] = [];
  const externalOrders = new Set(rows.filter(row => row.external_settlement_id).map(row => row.order_id));
  for (const row of rows) {
    if (!row.order_id || !row.order || row.order.id !== row.order_id ||
      ![null, "destination_charge", "separate_charges_and_transfers"].includes(row.order.charge_model)) return null;
    if (row.external_settlement_id !== null &&
      (typeof row.external_settlement_id !== "string" || !row.external_settlement_id)) return null;
    if (row.external_settlement_id) continue; // Exact immutable receipt-linked rows only.
    if (externalOrders.has(row.order_id)) return null; // Later unmatched reversal needs review.
    if (row.order.charge_model !== "separate_charges_and_transfers") {
      if (row.currency !== "usd") return null; // Existing legacy UI formats USD only.
      legacy.push(row);
    }
  }
  return legacy;
}
