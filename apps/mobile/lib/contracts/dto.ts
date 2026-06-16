import { z } from "zod";

export const LineItemCategoryDTO = z.enum(["admission", "coat_check"]);
export type LineItemCategory = z.infer<typeof LineItemCategoryDTO>;

export const CartLineItemDTO = z.object({
  lineItemId: z.string().uuid(),
  category: LineItemCategoryDTO,
  eventId: z.string().min(1),
  tierId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  attendees: z.array(z.object({ name: z.string() })).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CartLineItem = z.infer<typeof CartLineItemDTO>;

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
