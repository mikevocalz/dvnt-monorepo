import { tierAvailable, type TierInventory } from "./pricing.ts";

/** Display allowance only. Checkout must recheck under the inventory lock. */
export function ticketPurchaseAllowance(
  tier: TierInventory & { id: string; max_per_user?: number | null; max_per_order?: number | null },
  tickets: readonly { ticket_type_id?: string | null; status?: string | null }[] = [],
): number {
  const held = tickets.filter((ticket) =>
    ticket.ticket_type_id === tier.id &&
    ["active", "scanned", "transfer_pending"].includes(ticket.status ?? ""),
  ).length;
  const perPerson = Math.max(0, (tier.max_per_user || 4) - held);
  const perOrder = tier.max_per_order && tier.max_per_order > 0 ? tier.max_per_order : Infinity;
  return Math.max(0, Math.min(perPerson, perOrder, tierAvailable(tier)));
}
