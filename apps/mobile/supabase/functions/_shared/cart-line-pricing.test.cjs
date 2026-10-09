// Regression cover for the 2026-10-08 outage: every cart holding a coat-check
// add-on failed cart-checkout with 400 "Cart line item is invalid", because
// the price loop read ticket_types on add-on lines (tier_id NULL by the
// cart_line_items_target_check constraint). Production had 30 add-on carts
// and none of them ever completed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness } = require('./payment-safety.test.cjs');

const { priceCartLines, CART_LINE_PRICING_SELECT } =
  harness().load(path.resolve(__dirname, 'cart-line-pricing.ts'));

const EVENT = 85;
const cart = { event_id: EVENT, currency: 'usd' };
const tier = { price_cents: 2500, currency: 'usd', event_id: EVENT };
const coatCheck = { price_cents: 1000, currency: 'usd', event_id: EVENT };

const ticketLine = (over = {}) => ({ id: 't1', category: 'admission', tier_id: 'tier', addon_id: null,
  quantity: 1, ticket_types: tier, ticket_addons: null, ticket_addon_variants: null, ...over });
// Production stores add-on lines with category 'addon'.
const addonLine = (over = {}) => ({ id: 'a1', category: 'addon', tier_id: null, addon_id: 'coat',
  variant_id: null, quantity: 1, ticket_types: null, ticket_addons: coatCheck, ticket_addon_variants: null, ...over });

test('ticket line prices from its tier', () => {
  const r = priceCartLines([ticketLine({ quantity: 2 })], cart);
  assert.equal(r.ok, true);
  assert.equal(r.subtotalCents, 5000);
  assert.equal(r.ticketQuantity, 2);
  assert.equal(r.addonQuantity, 0);
});

test('add-on line prices from the add-on, not ticket_types', () => {
  const r = priceCartLines([addonLine()], cart);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.subtotalCents, 1000);
  assert.equal(r.addonQuantity, 1);
  assert.equal(r.ticketQuantity, 0);
});

test('add-on with a variant uses the variant price', () => {
  const r = priceCartLines([addonLine({ variant_id: 'v', ticket_addon_variants: { price_cents: 1500 }, quantity: 2 })], cart);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.subtotalCents, 3000);
});

test('variant with a null price falls back to the add-on price', () => {
  const r = priceCartLines([addonLine({ variant_id: 'v', ticket_addon_variants: { price_cents: null } })], cart);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.subtotalCents, 1000);
});

test('add-on from another event is rejected', () => {
  const r = priceCartLines([ticketLine(), addonLine({ ticket_addons: { ...coatCheck, event_id: 999 } })], cart);
  assert.deepEqual({ ok: r.ok, error: r.error, status: r.status },
    { ok: false, error: 'Cart line item is invalid', status: 400 });
});

test('a line with neither or both targets is rejected', () => {
  assert.equal(priceCartLines([addonLine({ addon_id: null })], cart).ok, false);
  assert.equal(priceCartLines([ticketLine({ addon_id: 'coat', ticket_addons: coatCheck })], cart).ok, false);
});

test('mixed currency is rejected, for add-ons too', () => {
  const r = priceCartLines([ticketLine(), addonLine({ ticket_addons: { ...coatCheck, currency: 'EUR' } })], cart);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Cart contains mixed currencies');
});

test('mixed ticket + add-on cart totals both', () => {
  const r = priceCartLines([ticketLine({ quantity: 2 }), addonLine({ quantity: 2 })], cart);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.subtotalCents, 2 * 2500 + 2 * 1000);
  assert.equal(r.quantity, 4);
  assert.equal(r.ticketQuantity, 2);
  assert.equal(r.addonQuantity, 2);
});

test('promoter discount base excludes add-ons', () => {
  const r = priceCartLines([ticketLine({ quantity: 2 }), addonLine({ quantity: 3 })], cart);
  assert.equal(r.admissionSubtotalCents, 5000);
  assert.equal(r.admissionQuantity, 2);
});

test('the checkout select embeds every join the pricing reads', () => {
  for (const join of ['ticket_types(', 'ticket_addons(', 'ticket_addon_variants(']) {
    assert.ok(CART_LINE_PRICING_SELECT.includes(join), join);
  }
});

// End to end through the real cart-checkout handler: a ticket + coat-check
// cart must reach Stripe and charge both lines.
test('cart-checkout charges a ticket + coat-check cart', async () => {
  const h = harness({ cart: [
    { id: 't1', category: 'admission', tier_id: 'tier', addon_id: null, quantity: 1,
      ticket_types: { price_cents: 5000, currency: 'usd', event_id: 1 } },
    { id: 'a1', category: 'addon', tier_id: null, addon_id: 'coat', variant_id: null, quantity: 1,
      ticket_addons: { price_cents: 1000, currency: 'usd', event_id: 1 }, ticket_addon_variants: null },
  ] });
  const r = await h.invoke('cart-checkout', { cartId: '00000000-0000-4000-8000-000000000001' });
  assert.equal(r.status, 200, await r.text());
  const order = h.writes.find(w => w.table === 'orders').payload;
  const pi = h.requests.find(q => q.url.endsWith('/payment_intents'));
  assert.equal(order.subtotal_cents, 6000);
  assert.equal(Number(pi.body.get('amount')), order.total_cents);
});
