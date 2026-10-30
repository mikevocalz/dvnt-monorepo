// Invoke the actual scheduled handler, real current-payment validation and
// cart-issuance helper; only database, Stripe and cron-observability boundaries
// are simulated. SQL locks/capacity are exercised in the dedicated PG suite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../stripe-webhook/cart-payment-fixture.cjs');

for (const rail of ['addon', 'admission', 'mixed']) test(`${rail}: marked historical payment_failed cart recovers through the real cron handler`, async () => {
  const f = fixture({ rail, status: 'payment_failed', cartStatus: 'abandoned' });
  const response = await f.reconcile();
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.stats.reconciled, 1);
  assert.equal(body.stats.needs_attention, 0);
  assert.equal(f.order.status, 'paid');
  assert.equal(f.cart.status, 'completed');
  assert.equal(f.tickets.length, rail === 'addon' ? 0 : 2);
  assert.equal(f.addons.length, rail === 'admission' ? 0 : 3);
  const selector = f.ops.find(op => op.rpc === 'list_paid_cart_recovery_candidates');
  assert.ok(selector);
  assert.equal(selector.args.p_limit, 50);
  assert.ok(Date.parse(selector.args.p_created_before) < Date.now());
  assert.equal(f.ops.filter(op => op.rpc === 'complete_paid_cart_atomic').length, 1);
  assert.equal(f.requests.length, 2, 'status read followed by fresh expanded-charge verification');
  assert.equal(f.requests[1].url.endsWith('?expand[]=latest_charge'), true);
  assert.ok(f.timeline.some(row => row.type === 'reconciled'));
});

test('pending and marked-recovery lists deduplicate the same cart before issuance', async () => {
  const f = fixture({ status: 'payment_pending', recoveryCandidate: true });
  const response = await f.reconcile();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stats.reconciled, 1);
  assert.equal(f.ops.filter(op => op.rpc === 'complete_paid_cart_atomic').length, 1);
  assert.equal(f.addons.length, 3);
});

test('unmarked failed checkout is not silently reopened or retried', async () => {
  const f = fixture({ status: 'payment_failed', cartStatus: 'abandoned', recoveryCandidate: false });
  const response = await f.reconcile();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stats.reconciled, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.order.status, 'payment_failed');
  assert.equal(f.ops.some(op => op.rpc === 'complete_paid_cart_atomic'), false);
});

for (const rail of ['addon', 'mixed']) test(`${rail}: unavailable stock reports attention, not false recovery or refund`, async () => {
  const f = fixture({ rail, status: 'payment_failed', cartStatus: 'abandoned' });
  f.state.inventoryAvailable = false;
  const response = await f.reconcile();
  assert.equal(response.status, 200);
  const { stats } = await response.json();
  assert.equal(stats.reconciled, 0);
  assert.equal(stats.needs_attention, 1);
  assert.equal(stats.failed, 1);
  assert.equal(f.tickets.length + f.addons.length, 0);
  assert.equal(f.order.status, 'payment_pending');
  assert.equal(f.cart.status, 'abandoned');
  assert.equal(f.timeline.some(row => row.type === 'reconciled'), false);
  assert.equal(f.requests.some(row => row.url.includes('/refunds')), false);
});

test('mixed cart with a partial ticket allocation is still validated atomically, never falsely counted as reconciled', async () => {
  const f = fixture({ rail: 'mixed', status: 'payment_failed', cartStatus: 'abandoned', existingTickets: 1 });
  const response = await f.reconcile();
  assert.equal(response.status, 200);
  const { stats } = await response.json();
  assert.equal(stats.reconciled, 0);
  assert.equal(stats.needs_attention, 1);
  assert.equal(f.ops.filter(op => op.rpc === 'complete_paid_cart_atomic').length, 1, 'an existing admission row cannot bypass whole-cart validation');
  assert.equal(f.tickets.length, 1);
  assert.equal(f.addons.length, 0);
  assert.equal(f.order.status, 'payment_pending');
});

for (const field of ['refunded', 'disputed']) test(`current ${field} charge cannot be recovered from the old success marker`, async () => {
  const f = fixture({ status: 'payment_failed', cartStatus: 'abandoned' });
  f.currentPayment.latest_charge[field] = true;
  const response = await f.reconcile();
  assert.equal(response.status, 200);
  const { stats } = await response.json();
  assert.equal(stats.reconciled, 0);
  assert.equal(stats.failed, 1);
  assert.equal(stats.needs_attention, 1, 'verification failure cannot be an all-zero healthy run');
  assert.equal(f.ops.some(op => op.rpc === 'complete_paid_cart_atomic'), false);
  assert.equal(f.order.status, 'payment_failed');
  assert.equal(f.tickets.length + f.addons.length, 0);
  assert.equal(f.captures.length, 1);
});

test('Stripe outage cannot allocate or claim success in reconciliation', async () => {
  const f = fixture({ status: 'payment_failed', cartStatus: 'abandoned' });
  f.state.stripeError = true;
  const response = await f.reconcile();
  assert.equal(response.status, 200);
  const { stats } = await response.json();
  assert.equal(stats.reconciled, 0);
  assert.equal(stats.failed, 1);
  assert.equal(stats.needs_attention, 1, 'Stripe outage must not appear as an all-zero healthy sweep');
  assert.equal(f.ops.some(op => op.rpc === 'complete_paid_cart_atomic'), false);
  assert.equal(f.order.status, 'payment_failed');
});

test('candidate selector database failure is a failed run, not an all-zero healthy report', async () => {
  const f = fixture({ status: 'payment_failed' }); f.state.candidateError = true;
  assert.equal((await f.reconcile()).status, 500);
  assert.equal(f.requests.length, 0);
});

test('recovery cron still rejects a request without its secret', async () => {
  const f = fixture({ status: 'payment_failed' });
  assert.equal((await f.reconcile({})).status, 401);
  assert.equal(f.ops.length, 0);
  assert.equal(f.requests.length, 0);
});


test('receipt drain remains behind existing cron secret auth', async () => {
 const f=fixture({status:'paid'}); const r=await f.reconcile({'x-cron-secret':'wrong'});
 assert.equal(r.status,401); assert.equal(f.ops.some(op=>op.rpc==='claim_ticket_receipts'),false);
});
test('receipt queue outage never undoes successful payment reconciliation', async () => {
 const f=fixture({status:'payment_failed',cartStatus:'abandoned'}); f.state.receiptQueueError=true;
 const r=await f.reconcile(); assert.equal(r.status,200); assert.equal((await r.json()).stats.reconciled,1);
 assert.equal(f.order.status,'paid'); assert.equal(f.cart.status,'completed');
 assert.equal(f.ops.filter(op=>op.rpc==='claim_ticket_receipts').length,1);
 assert.equal(f.ops.find(op=>op.rpc==='claim_ticket_receipts').args.p_limit,25);
});
