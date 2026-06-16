import type { CartLineItem } from "@dvnt/app/lib/contracts/dto";

export interface CartTotalInput {
  lineItems: CartLineItem[];
  feeCents: number;
  taxCents: number;
  totalCents: number;
}

export interface CurrencyLine {
  currency: string;
}

function assertIntegerCents(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer cent value`);
  }
}

export function calculateCartSubtotalCents(lineItems: CartLineItem[]): number {
  return lineItems.reduce((sum, lineItem) => {
    assertIntegerCents(lineItem.unitPriceCents, "unitPriceCents");
    if (!Number.isInteger(lineItem.quantity) || lineItem.quantity <= 0) {
      throw new Error("quantity must be a positive integer");
    }
    return sum + lineItem.unitPriceCents * lineItem.quantity;
  }, 0);
}

export function assertPositiveCartQuantities(lineItems: CartLineItem[]): void {
  for (const lineItem of lineItems) {
    if (!Number.isInteger(lineItem.quantity) || lineItem.quantity <= 0) {
      throw new Error(`line item ${lineItem.lineItemId} has invalid quantity`);
    }
  }
}

export function assertSingleCurrencyCart(lines: CurrencyLine[]): void {
  const currencies = new Set(lines.map((line) => line.currency.toLowerCase()));
  if (currencies.size > 1) {
    throw new Error("cart must use a single currency");
  }
}

export function assertCartTotals(input: CartTotalInput): void {
  assertPositiveCartQuantities(input.lineItems);
  assertIntegerCents(input.feeCents, "feeCents");
  assertIntegerCents(input.taxCents, "taxCents");
  assertIntegerCents(input.totalCents, "totalCents");

  const expectedTotal =
    calculateCartSubtotalCents(input.lineItems) +
    input.feeCents +
    input.taxCents;

  if (input.totalCents !== expectedTotal) {
    throw new Error(
      `cart total mismatch: expected ${expectedTotal}, received ${input.totalCents}`,
    );
  }
}
