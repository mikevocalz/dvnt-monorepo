import { z } from "zod";

// admission/coat_check = legacy ticket lines; product/service = coarse add-on
// tickets; addon = the rich add-on domain (order_addons + variant matrix).
export const LineItemCategoryDTO = z.enum([
  "admission",
  "coat_check",
  "product",
  "service",
  "addon",
]);
export type LineItemCategory = z.infer<typeof LineItemCategoryDTO>;

export const CartLineItemDTO = z.object({
  lineItemId: z.string().uuid(),
  category: LineItemCategoryDTO,
  eventId: z.string().min(1),
  // tierId is the ticket_types id for ticket lines; for `addon` lines it is the
  // addon id (kept on tierId for back-compat) with addonId set explicitly too.
  tierId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  attendees: z.array(z.object({ name: z.string() })).optional(),
  // ── Tier-model v2 additions (all optional, back-compat) ──
  /** Hidden-tier unlock code supplied by the buyer. */
  unlockCode: z.string().optional(),
  /** Pay-what-you-want amount for donation tiers/add-ons (>= floor, server-checked). */
  donationAmountCents: z.number().int().nonnegative().optional(),
  // ── Add-on lines ──
  /** ticket_addons.id when category === "addon". */
  addonId: z.string().uuid().optional(),
  /** ticket_addon_variants.id for merch variant lines. */
  variantId: z.string().uuid().optional(),
  /** For per_ticket binding — the ticket this add-on attaches to. */
  boundTicketLineItemId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CartLineItem = z.infer<typeof CartLineItemDTO>;

// ── Tier definition DTO (mirror of ticket_types v2 columns) ──
export const TicketTierTypeDTO = z.enum([
  "ga", "vip", "early_bird", "table_service", "group_bundle", "comp", "donation",
]);
export const TierStatusDTO = z.enum([
  "draft", "scheduled", "on_sale", "paused", "sold_out", "ended",
]);
export const TierVisibilityDTO = z.enum(["public", "hidden", "locked"]);
export const PriceScheduleEntryDTO = z.object({
  effective_at: z.string(),
  price_cents: z.number().int().nonnegative(),
});
export const SubAllocationDTO = z.object({
  quantity: z.number().int().positive(),
  price_cents: z.number().int().nonnegative(),
});
export const TicketTierDTO = z.object({
  id: z.string().uuid(),
  event_id: z.number().int().positive(),
  name: z.string(),
  tier_type: TicketTierTypeDTO.default("ga"),
  price_cents: z.number().int().nonnegative(),
  min_price_cents: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().length(3).default("usd"),
  quantity_total: z.number().int().nonnegative().nullable(),
  quantity_sold: z.number().int().nonnegative().default(0),
  quantity_held: z.number().int().nonnegative().default(0),
  quantity_reserved_comp: z.number().int().nonnegative().default(0),
  price_schedule: z.array(PriceScheduleEntryDTO).default([]),
  sub_allocations: z.array(SubAllocationDTO).default([]),
  max_per_order: z.number().int().positive().nullable().optional(),
  max_per_user: z.number().int().positive().nullable().optional(),
  sale_start: z.string().nullable().optional(),
  sale_end: z.string().nullable().optional(),
  tier_visibility: TierVisibilityDTO.default("public"),
  unlocks_after_tier_id: z.string().uuid().nullable().optional(),
  status: TierStatusDTO.default("on_sale"),
  sort_order: z.number().int().default(0),
});
export type TicketTier = z.infer<typeof TicketTierDTO>;

// ── Add-on DTOs (mirror ticket_addons / variants / order_addons) ──
export const AddonTypeDTO = z.enum([
  "merch", "coat_check", "drink_package", "parking", "skip_line", "meet_greet", "donation",
]);
export const AddonBindingDTO = z.enum(["per_ticket", "per_order", "standalone"]);
export const AddonVariantDTO = z.object({
  id: z.string().uuid(),
  addon_id: z.string().uuid(),
  name: z.string(),
  option_values: z.record(z.string(), z.string()).default({}),
  price_cents: z.number().int().nonnegative().nullable().optional(),
  quantity_total: z.number().int().nonnegative().nullable(),
  quantity_sold: z.number().int().nonnegative().default(0),
  quantity_held: z.number().int().nonnegative().default(0),
  sku: z.string().nullable().optional(),
  sort_order: z.number().int().default(0),
});
export const AddonDTO = z.object({
  id: z.string().uuid(),
  event_id: z.number().int().positive(),
  name: z.string(),
  description: z.string().nullable().optional(),
  addon_type: AddonTypeDTO.default("merch"),
  binding_mode: AddonBindingDTO.default("standalone"),
  price_cents: z.number().int().nonnegative(),
  min_price_cents: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().length(3).default("usd"),
  quantity_total: z.number().int().nonnegative().nullable(),
  quantity_sold: z.number().int().nonnegative().default(0),
  quantity_held: z.number().int().nonnegative().default(0),
  has_variants: z.boolean().default(false),
  requires_tier_id: z.string().uuid().nullable().optional(),
  is_redeemable: z.boolean().default(false),
  image_url: z.string().nullable().optional(),
  sort_order: z.number().int().default(0),
  status: z.enum(["draft", "on_sale", "paused", "sold_out", "ended"]).default("on_sale"),
  variants: z.array(AddonVariantDTO).default([]),
});
export type Addon = z.infer<typeof AddonDTO>;
export type AddonVariant = z.infer<typeof AddonVariantDTO>;

export const CartStatusDTO = z.enum([
  "draft",
  "holding",
  "paying",
  "completed",
  "abandoned",
]);
export type CartStatus = z.infer<typeof CartStatusDTO>;

export const CartDTO = z.object({
  cartId: z.string().uuid(),
  eventId: z.string().min(1),
  lineItems: z.array(CartLineItemDTO),
  holdExpiresAt: z.number().int().positive().optional(),
  paymentIntentId: z.string().optional(),
  status: CartStatusDTO,
  idempotencyKey: z.string().uuid(),
});
export type Cart = z.infer<typeof CartDTO>;

export const MixedTicketDTO = z.object({
  id: z.string().uuid(),
  event_id: z.number().int().positive(),
  ticket_type_id: z.string().uuid().nullable().optional(),
  status: z.string(),
  qr_token: z.string().nullable().optional(),
  qr_payload: z.string().nullable().optional(),
  purchase_amount_cents: z.number().int().nonnegative().nullable().optional(),
  category: z
    .enum(["admission", "coat_check", "product", "service"])
    .optional(),
  cart_id: z.string().uuid().nullable().optional(),
  cart_line_item_id: z.string().uuid().nullable().optional(),
  ticket_type_name: z.string().optional(),
  event_title: z.string().optional(),
  event_image: z.string().optional(),
  event_date: z.string().optional(),
  event_end_date: z.string().nullable().optional(),
  event_location: z.string().optional(),
});
export type MixedTicket = z.infer<typeof MixedTicketDTO>;

export const CartHoldResponseDTO = z.object({
  ok: z.literal(true),
  cartId: z.string().uuid(),
  holdExpiresAt: z.string(),
});
export type CartHoldResponse = z.infer<typeof CartHoldResponseDTO>;

export const CartCheckoutResponseDTO = z.object({
  ok: z.literal(true),
  cartId: z.string().uuid(),
  clientSecret: z.string(),
  paymentIntent: z.string(),
  paymentIntentId: z.string(),
  ephemeralKey: z.string(),
  customer: z.string(),
  publishableKey: z.string(),
  holdExpiresAt: z.string().nullable().optional(),
  totals: z.object({
    subtotalCents: z.number().int().nonnegative(),
    buyerFeeCents: z.number().int().nonnegative(),
    discountCents: z.number().int().nonnegative().optional(),
    totalCents: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }),
});
export type CartCheckoutResponse = z.infer<typeof CartCheckoutResponseDTO>;

export const CartStatusResponseDTO = z.object({
  ok: z.literal(true),
  cart: z.object({
    id: z.string().uuid(),
    eventId: z.number().int().positive(),
    status: CartStatusDTO,
    paymentIntentId: z.string().nullable().optional(),
    totalCents: z.number().int().nonnegative(),
    feeCents: z.number().int().nonnegative(),
    taxCents: z.number().int().nonnegative(),
    currency: z.string().length(3),
    updatedAt: z.string().nullable().optional(),
  }),
  lineItems: z.array(
    z.object({
      id: z.string().uuid(),
      category: LineItemCategoryDTO,
      tierId: z.string().uuid(),
      tierName: z.string(),
      quantity: z.number().int().positive(),
      unitPriceCents: z.number().int().nonnegative(),
      refundedAmountCents: z.number().int().nonnegative(),
      metadata: z.record(z.string(), z.unknown()),
    }),
  ),
  holds: z.object({
    active: z.boolean(),
    expiresAt: z.string().nullable(),
    items: z.array(z.unknown()),
  }),
  tickets: z.array(MixedTicketDTO),
  completed: z.boolean(),
});
export type CartStatusResponse = z.infer<typeof CartStatusResponseDTO>;

export const CartLineRefundResponseDTO = z.object({
  ok: z.literal(true),
  cartId: z.string().uuid(),
  lineItemId: z.string().uuid(),
  refundId: z.string().nullable().optional(),
  amountCents: z.number().int().nonnegative(),
  message: z.string().optional(),
});
export type CartLineRefundResponse = z.infer<typeof CartLineRefundResponseDTO>;

export function parseDTO<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}
