/**
 * Server-side pricing for cart_line_items, shared by cart-checkout.
 *
 * A cart line is a ticket tier or an add-on (coat check etc.), never both:
 * cart_line_items_target_check is CHECK ((tier_id IS NOT NULL) <> (addon_id IS
 * NOT NULL)). Ticket lines price from ticket_types; add-on lines price as
 * variant ?? add-on, the rule cart_create_hold uses
 * (migrations/20260613145108_cart_addons_holds.sql). Reading ticket_types for
 * every line is the bug that turned every coat-check cart into a 400.
 *
 * Pure: no Deno or Supabase imports, so the node test can load it directly.
 */

export type CartLinePricingRow = {
  id: string;
  category: string;
  tier_id: string | null;
  addon_id: string | null;
  variant_id?: string | null;
  quantity: number;
  ticket_types?: {
    price_cents: number;
    currency?: string | null;
    event_id: number;
  } | null;
  ticket_addons?: {
    price_cents: number;
    currency?: string | null;
    event_id: number;
  } | null;
  ticket_addon_variants?: { price_cents: number | null } | null;
};

export type CartPricing = {
  ok: true;
  subtotalCents: number;
  /** Every unit in the cart, tickets and add-ons. */
  quantity: number;
  /** Units on ticket-tier lines only. */
  ticketQuantity: number;
  /** Units on add-on lines only. */
  addonQuantity: number;
  /** Promoter discounts apply to admission tickets only. */
  admissionSubtotalCents: number;
  admissionQuantity: number;
};

export type CartPricingError = { ok: false; error: string; status: number };

/** The column list cart-checkout selects so every line can be priced. */
export const CART_LINE_PRICING_SELECT =
  "*, ticket_types(price_cents, currency, event_id, name, category), ticket_addons(price_cents, currency, event_id), ticket_addon_variants(price_cents)";

export function priceCartLines(
  lines: CartLinePricingRow[],
  cart: { event_id: number; currency?: string | null },
): CartPricing | CartPricingError {
  const currency = String(cart.currency || "usd").toLowerCase();
  let subtotalCents = 0;
  let quantity = 0;
  let ticketQuantity = 0;
  let addonQuantity = 0;
  let admissionSubtotalCents = 0;
  let admissionQuantity = 0;

  for (const line of lines) {
    const isTicket = Boolean(line.tier_id);
    const isAddon = Boolean(line.addon_id);
    if (isTicket === isAddon) {
      return { ok: false, error: "Cart line item is invalid", status: 400 };
    }
    const source = isTicket ? line.ticket_types : line.ticket_addons;
    if (!source || Number(source.event_id) !== Number(cart.event_id)) {
      return { ok: false, error: "Cart line item is invalid", status: 400 };
    }
    const unitPriceCents = isTicket
      ? source.price_cents
      : (line.ticket_addon_variants?.price_cents ?? source.price_cents);
    const lineCurrency = String(source.currency || currency).toLowerCase();
    if (lineCurrency !== currency) {
      return { ok: false, error: "Cart contains mixed currencies", status: 400 };
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      return { ok: false, error: "Cart line item quantity is invalid", status: 400 };
    }
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
      return { ok: false, error: "Cart line item price is invalid", status: 400 };
    }

    const lineTotal = unitPriceCents * line.quantity;
    subtotalCents += lineTotal;
    quantity += line.quantity;
    if (isTicket) ticketQuantity += line.quantity;
    else addonQuantity += line.quantity;

    if (isTicket && line.category === "admission") {
      admissionSubtotalCents += lineTotal;
      admissionQuantity += line.quantity;
    }
  }

  return {
    ok: true,
    subtotalCents,
    quantity,
    ticketQuantity,
    addonQuantity,
    admissionSubtotalCents,
    admissionQuantity,
  };
}
