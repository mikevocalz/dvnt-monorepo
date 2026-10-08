// A Tap to Pay retry after a lost response must not charge twice or take a
// second inventory hold. door-sell keys the PaymentIntent on the client's
// sale_key and returns the existing order when Stripe replays that intent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./payment-safety.test.cjs');

const SALE_KEY = '3f6c1a2e-8b4d-4c1f-9a7e-2d5b6c7e8f90';

function terminalSale(config) {
  const stripeHeaders = [];
  const h = harness({
    ...config,
    stripeFetch: async (url, init) => {
      if (String(url).includes('/payment_intents')) stripeHeaders.push(init.headers);
      return Response.json({ id: 'pi_door', client_secret: 'pi_door_secret' });
    },
  });
  return { h, stripeHeaders };
}

const sell = (h, extra = {}) => h.invoke('door-sell', {
  action: 'sell_terminal', event_id: 1, ticket_type_id: 'tier', quantity: 1,
  guest_email: 'buyer@test.co', ...extra,
});

test('sell_terminal sends the sale key to Stripe as the idempotency key', async () => {
  const { h, stripeHeaders } = terminalSale({});
  const r = await sell(h, { sale_key: SALE_KEY });
  assert.equal(r.status, 200, await r.text());
  assert.equal(stripeHeaders.length, 1);
  assert.equal(stripeHeaders[0]['Idempotency-Key'], `door-sell:staff:${SALE_KEY}`);
});

test('a replayed sale returns the existing order without a second hold or order', async () => {
  // The harness answers every orders lookup with an existing row, which is
  // what the server sees when Stripe replays the PaymentIntent for this key.
  const { h } = terminalSale({});
  const r = await sell(h, { sale_key: SALE_KEY });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.order_id, 'order');
  assert.equal(body.paymentIntentId, 'pi_door');
  assert.ok(!h.calls.some(c => c.name === 'ticket_hold_create_atomic'), 'no second hold');
  assert.ok(!h.writes.some(w => w.table === 'orders' && w.operation === 'insert'), 'no second order');
});

test('without a sale key the sale takes a hold and creates its order', async () => {
  const { h, stripeHeaders } = terminalSale({});
  const r = await sell(h);
  assert.equal(r.status, 200, await r.text());
  assert.equal(stripeHeaders[0]['Idempotency-Key'], undefined);
  assert.ok(h.calls.some(c => c.name === 'ticket_hold_create_atomic'));
  assert.ok(h.writes.some(w => w.table === 'orders' && w.operation === 'insert'));
});

test('a malformed sale key is ignored rather than forwarded to Stripe', async () => {
  const { h, stripeHeaders } = terminalSale({});
  const r = await sell(h, { sale_key: 'x' });
  assert.equal(r.status, 200, await r.text());
  assert.equal(stripeHeaders[0]['Idempotency-Key'], undefined);
});

test('sell_terminal creates a card_present PaymentIntent with automatic capture', async () => {
  const bodies = [];
  const h = harness({
    stripeFetch: async (url, init) => {
      if (String(url).includes('/payment_intents')) bodies.push(new URLSearchParams(init.body));
      return Response.json({ id: 'pi_door', client_secret: 'pi_door_secret' });
    },
  });
  const r = await sell(h);
  assert.equal(r.status, 200, await r.text());
  assert.equal(bodies[0].get('payment_method_types[]'), 'card_present');
  assert.equal(bodies[0].get('capture_method'), 'automatic');
  assert.equal(bodies[0].get('automatic_payment_methods[enabled]'), null);
  assert.equal(bodies[0].get('metadata[payment_rail]'), 'terminal');
});
