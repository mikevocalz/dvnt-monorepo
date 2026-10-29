// Signed production webhook + real cart issuance/money helpers. The stateful
// database boundary models transactional issuance; real SQL concurrency is
// covered separately, not claimed by this fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./cart-payment-fixture.cjs');


for (const rail of ['addon', 'admission', 'mixed']) {
  test(`${rail}: failed payment attempts preserve the bounded hold and later success fulfills once`, async () => {
    const f = fixture({ rail });
    const originalDeadline = f.hold.expires_at;
    for (let i = 0; i < 2; i++) {
      const response = await f.run('payment_intent.payment_failed', { eventId: `evt_decline_${i}`, age: i });
      assert.equal(response.status, 200, await response.text());
      assert.equal(f.cart.status, 'holding', 'a retryable payment attempt must not abandon the cart');
      assert.equal(f.hold.released, false, 'keep original reservation until normal expiry');
      assert.equal(f.hold.expires_at, originalDeadline, 'declines must not extend inventory reservation');
      assert.equal(f.order.status, 'payment_pending', 'order must stay in the reconciliation queue');
    }
    const success = await f.run('payment_intent.succeeded', { age: 2 });
    assert.equal(success.status, 200, await success.text());
    assert.equal(f.order.status, 'paid');
    assert.equal(f.cart.status, 'completed');
    assert.equal(f.tickets.length, rail === 'addon' ? 0 : 2);
    assert.equal(f.addons.length, rail === 'admission' ? 0 : 3);
    assert.equal(f.ops.some(op => op.rpc === 'cart_release_hold'), false);
    assert.equal(f.requests.some(r => r.url.includes('/refunds')), false);
  });

  test(`${rail}: success, duplicate delivery and distinct replay never duplicate fulfilled units`, async () => {
    const f = fixture({ rail });
    for (const eventId of ['evt_success', 'evt_success', 'evt_distinct_success']) {
      const response = await f.run('payment_intent.succeeded', { eventId });
      assert.equal(response.status, 200, await response.text());
    }
    assert.equal(f.tickets.length, rail === 'addon' ? 0 : 2);
    assert.equal(f.addons.length, rail === 'admission' ? 0 : 3);
    assert.equal(f.events.get('evt_success').processed_at != null, true);
    assert.equal(f.ops.filter(op => op.rpc === 'complete_paid_cart_atomic').length, 2);
  });

  test(`${rail}: success followed by delayed failure cannot release or downgrade a completed purchase`, async () => {
    const f = fixture({ rail });
    assert.equal((await f.run('payment_intent.succeeded', { eventId: 'evt_success', age: 2 })).status, 200);
    for (const age of [0, 3]) {
      const response = await f.run('payment_intent.payment_failed', { eventId: `evt_late_failure_${age}`, age });
      assert.equal(response.status, 200, await response.text());
      assert.equal(f.order.status, 'paid');
      assert.equal(f.cart.status, 'completed');
    }
    assert.equal(f.ops.some(op => op.rpc === 'cart_release_hold'), false);
    assert.equal(f.tickets.length, rail === 'addon' ? 0 : 2);
    assert.equal(f.addons.length, rail === 'admission' ? 0 : 3);
  });
}

for (const status of ['refunded', 'cancelled']) test(`failed attempt cannot reopen ${status} order`, async () => {
  const f = fixture({ status });
  assert.equal((await f.run('payment_intent.payment_failed')).status, 200);
  assert.equal(f.order.status, status);
  assert.equal(f.ops.some(op => op.rpc === 'cart_release_hold'), false);
  assert.equal(f.tickets.length + f.addons.length, 0);
});

test('concurrent success replays and a delayed failed attempt fulfill exactly once', async () => {
  const f = fixture({ rail: 'mixed' });
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const entering = new Promise(resolve => { entered = resolve; });
  f.state.issuanceGate = async () => { entered(); await gate; };
  const first = f.run('payment_intent.succeeded', { eventId: 'evt_parallel_one', age: 2 });
  await entering;
  const failure = await f.run('payment_intent.payment_failed', { eventId: 'evt_parallel_failure', age: 1 });
  assert.equal(failure.status, 200);
  assert.equal(f.hold.released, false);
  const second = f.run('payment_intent.succeeded', { eventId: 'evt_parallel_two', age: 2 });
  release();
  for (const response of await Promise.all([first, second])) assert.equal(response.status, 200, await response.text());
  assert.equal(f.tickets.length, 2);
  assert.equal(f.addons.length, 3);
  assert.equal(f.order.status, 'paid');
  assert.equal(f.ops.some(op => op.rpc === 'cart_release_hold'), false);
});

for (const rail of ['addon', 'admission', 'mixed']) for (const options of [{ cartStatus: 'abandoned' }, { expired: true }]) {
  test(`${rail}: verified payment recovers released/expired hold atomically: ${JSON.stringify(options)}`, async () => {
    const f = fixture({ rail, status: 'payment_failed', ...options });
    const response = await f.run('payment_intent.succeeded', { eventId: 'evt_recovery' });
    assert.equal(response.status, 200, await response.text());
    assert.equal(f.order.status, 'paid');
    assert.equal(f.cart.status, 'completed');
    assert.equal(f.tickets.length, rail === 'addon' ? 0 : 2);
    assert.equal(f.addons.length, rail === 'admission' ? 0 : 3);
    const allocation = f.ops.find(op => op.rpc === 'complete_paid_cart_atomic');
    assert.equal(allocation.args.p_amount_received, 2250);
    assert.equal(allocation.args.p_currency, 'usd');
    assert.equal(allocation.args.p_user_id, 'member_fixture');
    assert.equal(allocation.args.p_event_id, 7);
    assert.equal(f.ops.some(op => ['cart_holds', 'carts', 'tickets', 'order_addons'].includes(op.table) && op.kind !== 'select'), false,
      'edge must not rearm inventory through split REST writes');
  });
}

for (const options of [{ inventoryAvailable: false }, { issuanceError: true }]) {
  test(`blocked paid fulfillment remains retryable without inventing inventory or refund: ${JSON.stringify(options)}`, async () => {
    const f = fixture({ rail: 'mixed', status: 'payment_failed', cartStatus: 'abandoned' });
    Object.assign(f.state, options);
    const response = await f.run('payment_intent.succeeded', { eventId: 'evt_blocked' });
    assert.equal(response.status, 500);
    assert.equal(f.events.get('evt_blocked').processed_at, null);
    assert.equal(f.tickets.length + f.addons.length, 0);
    assert.equal(f.cart.status, 'abandoned');
    assert.equal(f.requests.some(r => r.url.includes('/refunds')), false);
    if (!options.issuanceError) {
      assert.ok(f.timeline.some(row => row.type === 'reconcile_blocked' && /fulfillment/i.test(row.label)));
      assert.equal(f.order.status, 'payment_pending', 'confirmed blocked fulfillment must be discoverable by reconciliation');
    }
    f.state.inventoryAvailable = true;
    f.state.issuanceError = false;
    assert.equal((await f.run('payment_intent.succeeded', { eventId: 'evt_blocked' })).status, 200);
    assert.equal(f.tickets.length, 2);
    assert.equal(f.addons.length, 3);
  });
}

for (const [name, mutate] of [
  ['no current success', pi => { pi.status = 'requires_payment_method'; }],
  ['captured amount short', pi => { pi.amount_received = 2200; }],
  ['wrong payment reference', pi => { pi.id = 'pi_wrong'; }],
  ['wrong cart metadata', pi => { pi.metadata.cart_id = 'cart_wrong'; }],
  ['missing owner metadata', pi => { delete pi.metadata.user_id; }],
  ['invalid event metadata', pi => { pi.metadata.event_id = '-7'; }],
  ['unexpanded charge', pi => { pi.latest_charge = 'ch_fixture'; }],
  ['uncaptured charge', pi => { pi.latest_charge.captured = false; }],
  ['refunded charge', pi => { pi.latest_charge.refunded = true; }],
  ['partially refunded charge', pi => { pi.latest_charge.amount_refunded = 1; }],
  ['disputed charge', pi => { pi.latest_charge.disputed = true; }],
  ['wrong charge PI', pi => { pi.latest_charge.payment_intent = 'pi_wrong'; }],
]) test(`old succeeded snapshot cannot allocate against ${name}`, async () => {
  const f = fixture({ cartStatus: 'abandoned', status: 'payment_failed' });
  mutate(f.currentPayment);
  assert.equal((await f.run('payment_intent.succeeded')).status, 500);
  assert.equal(f.ops.some(op => op.rpc === 'complete_paid_cart_atomic'), false);
  assert.equal(f.tickets.length + f.addons.length, 0);
  assert.equal(f.events.get('evt_payment_intent_succeeded').processed_at, null);
});

for (const [name, mutate] of [
  ['wrong owner', pi => { pi.metadata.user_id = 'other_member'; }],
  ['wrong event', pi => { pi.metadata.event_id = '8'; }],
  ['wrong currency', pi => { pi.currency = 'eur'; }],
  ['wrong total', pi => { pi.amount = pi.amount_received = 2300; }],
]) test(`atomic boundary rejects otherwise-paid metadata with ${name}`, async () => {
  const f = fixture({ cartStatus: 'abandoned', status: 'payment_failed' });
  mutate(f.currentPayment);
  assert.equal((await f.run('payment_intent.succeeded')).status, 500);
  assert.equal(f.tickets.length + f.addons.length, 0);
  assert.equal(f.cart.status, 'abandoned');
});

test('Stripe verification outage keeps payment event retryable without allocation', async () => {
  const f = fixture(); f.state.stripeError = true;
  assert.equal((await f.run('payment_intent.succeeded')).status, 500);
  assert.equal(f.ops.some(op => op.rpc === 'complete_paid_cart_atomic'), false);
  assert.equal(f.events.get('evt_payment_intent_succeeded').processed_at, null);
});

test('failed completion marker can retry an already fulfilled cart without double allocation', async () => {
  const f = fixture({ rail: 'mixed' });
  f.state.markerError = true;
  assert.equal((await f.run('payment_intent.succeeded', { eventId: 'evt_marker' })).status, 500);
  assert.equal(f.events.get('evt_marker').processed_at, null);
  f.state.markerError = false;
  assert.equal((await f.run('payment_intent.succeeded', { eventId: 'evt_marker' })).status, 200);
  assert.equal(f.tickets.length, 2);
  assert.equal(f.addons.length, 3);
});

test('invalid signature cannot mutate cart, order or inventory', async () => {
  const f = fixture();
  assert.equal((await f.run('payment_intent.payment_failed', { invalidSignature: true })).status, 400);
  assert.equal(f.ops.length, 0);
  assert.equal(f.order.status, 'payment_pending');
  assert.equal(f.hold.released, false);
});

// A replacement PI belongs to a new checkout attempt. Old failure events may
// not attach a misleading decline to that attempt or release its stock.
test('old PI failure cannot annotate a replacement checkout attempt', async () => {
  const f = fixture();
  f.order.stripe_payment_intent_id = 'pi_replacement';
  f.cart.stripe_pi_id = 'pi_replacement';
  assert.equal((await f.run('payment_intent.payment_failed')).status, 200);
  assert.equal(f.order.checkout_failure_reason, undefined);
  assert.equal(f.order.status, 'payment_pending');
  assert.equal(f.hold.released, false);
  assert.equal(f.timeline.length, 0);
});

for (const age of [0, 3]) test(`processing event after success does not downgrade order (offset ${age})`, async () => {
  const f = fixture({ rail: 'mixed' });
  assert.equal((await f.run('payment_intent.succeeded', { age: 2 })).status, 200);
  assert.equal((await f.run('payment_intent.processing', { age, piStatus: 'processing' })).status, 200);
  assert.equal(f.order.status, 'paid');
  assert.equal(f.cart.status, 'completed');
  assert.equal(f.tickets.length, 2);
  assert.equal(f.addons.length, 3);
  assert.equal(f.ops.some(op => op.rpc === 'upsert_order_money_state'), false, 'cart processing must not issue a status-changing money RPC after a stale read');
});

test('processing pending read racing success cannot downgrade the completed purchase', async () => {
  const f = fixture({ rail: 'mixed' });
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const entering = new Promise(resolve => { entered = resolve; });
  f.state.orderReadGate = async () => { entered(); await gate; };
  const processing = f.run('payment_intent.processing', { age: 3, piStatus: 'processing' });
  await entering;
  assert.equal((await f.run('payment_intent.succeeded', { age: 2 })).status, 200);
  release();
  assert.equal((await processing).status, 200);
  assert.equal(f.order.status, 'paid');
  assert.equal(f.cart.status, 'completed');
  assert.equal(f.tickets.length, 2);
  assert.equal(f.addons.length, 3);
  assert.equal(f.ops.some(op => op.rpc === 'upsert_order_money_state'), false);
});

test('failed-attempt annotation database error leaves event retryable and hold unchanged', async () => {
  const f = fixture(); f.state.orderUpdateError = true;
  assert.equal((await f.run('payment_intent.payment_failed')).status, 500);
  assert.equal(f.events.get('evt_payment_intent_payment_failed').processed_at, null);
  assert.equal(f.hold.released, false);
  assert.equal(f.order.status, 'payment_pending');
  f.state.orderUpdateError = false;
  assert.equal((await f.run('payment_intent.payment_failed')).status, 200);
  assert.equal(f.hold.released, false);
});
