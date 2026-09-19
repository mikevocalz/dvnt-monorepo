/** Represent an exact discounted subtotal in integer-cent Stripe line items. */
export function checkoutTicketLines(
  subtotal: number,
  quantity: number,
  currency: string,
  name: string,
): { params: Record<string, string>; count: number } {
  if (!Number.isSafeInteger(subtotal) || subtotal < 0 ||
      !Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Invalid checkout subtotal or quantity");
  }
  const unit = Math.floor(subtotal / quantity);
  const remainder = subtotal % quantity;
  const groups = [
    { amount: unit, quantity: quantity - remainder },
    { amount: unit + 1, quantity: remainder },
  ].filter((group) => group.quantity > 0);
  const params: Record<string, string> = {};
  groups.forEach((group, i) => {
    params[`line_items[${i}][price_data][currency]`] = currency;
    params[`line_items[${i}][price_data][unit_amount]`] = String(group.amount);
    params[`line_items[${i}][price_data][product_data][name]`] = name;
    params[`line_items[${i}][quantity]`] = String(group.quantity);
  });
  return { params, count: groups.length };
}
