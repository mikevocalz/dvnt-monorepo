import type { TicketRecord } from "../api/tickets";
import type { TicketTypeRecord } from "../api/ticket-types";
import { resolveTicketAccess } from "./ticket-access.ts";
import { filterBuyerVisibleTiers, tierIsPurchasable } from "./pricing.ts";
import { ticketPurchaseAllowance } from "./purchase-quantity.ts";
import { isAdmissionUpgradeCategory, isAdmissionUpgradeSource } from "./upgrade-purpose.ts";

/** Wallet offers are previews, not a second checkout or admission entitlement.
 * A service is always a separate purchase, even when a comp cost less than it.
 * The event screen and server recheck sale windows, stock and buyer limits.
 */
export function resolveTicketDetailPurchases({ ticket, tiers, tickets, viewerId, viewerAuthId }: {
  ticket: TicketRecord | null | undefined;
  tiers: TicketTypeRecord[];
  tickets: TicketRecord[];
  viewerId: string | null | undefined;
  viewerAuthId?: string | null;
}) {
  const canBuyMore = resolveTicketAccess({ ticket, viewerId, viewerAuthId }).canShowCredential;
  if (!ticket || !canBuyMore) return { upgrades: [], services: [], canBuyMore: false };
  const owned = tickets.filter((row) => resolveTicketAccess({ ticket: row, viewerId, viewerAuthId }).isHolder);
  const available = filterBuyerVisibleTiers(tiers.filter((tier) =>
    String(tier.event_id) === String(ticket.event_id) && tier.is_active && tierIsPurchasable({ ...tier, status: tier.status ?? undefined }),
  )).visible;
  const services = available.filter((tier) =>
    tier.category === "service" && ticketPurchaseAllowance(tier, owned) > 0,
  );
  const upgrades = ticket.status === "active" && !ticket.checked_in_at && isAdmissionUpgradeSource(ticket, tiers)
    ? available.filter((tier) => isAdmissionUpgradeCategory(tier.category) &&
      tier.id !== ticket.ticket_type_id && tier.price_cents > (ticket.purchase_amount_cents ?? 0))
      .sort((a, b) => a.price_cents - b.price_cents)
    : [];
  return { upgrades, services, canBuyMore };
}

/** Selection only: never reserves inventory or starts a payment from a URL. */
export function ticketServicePurchaseHref(eventId: string, tierId: string, platform: "web" | "native") {
  const prefix = platform === "web" ? "/feed/events" : "/(protected)/events";
  return `${prefix}/${encodeURIComponent(eventId)}?serviceTier=${encodeURIComponent(tierId)}`;
}
