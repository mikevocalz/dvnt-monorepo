const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHmac } = require('node:crypto');
const ts = require('typescript');
const { harness } = require('./payment-safety.test.cjs');

function loadFeeModule(fetchImpl) {
  const exports = {};
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'stripe-processing-fee.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(source, {
    exports, Response, URLSearchParams,
    console: { log() {}, error() {}, warn() {} },
    fetch: fetchImpl,
  });
  return exports;
}

// In-memory orders table that understands the query shapes the module uses.
function fakeDb(rows) {
  const updates = [];
  return {
    rows, updates,
    from(table) {
      assert.equal(table, 'orders');
      const filters = [];
      let patch = null;
      const run = () => {
        const match = rows.filter(r => filters.every(([col, val]) => r[col] === val));
        if (patch) {
          for (const r of match) { Object.assign(r, patch); updates.push({ id: r.id, ...patch }); }
          return { data: null, error: null };
        }
        return { data: match.map(r => ({ ...r })), error: null };
      };
      const q = {
        select: () => q, order: () => q,
        eq: (col, val) => { filters.push([col, val]); return q; },
        is: (col, val) => { filters.push([col, val]); return q; },
        update: p => { patch = p; return q; },
        then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
      };
      return q;
    },
  };
}

const stripeFee = fee => async url => {
  assert.match(url, /latest_charge\.balance_transaction/);
  return Response.json({ id: 'pi_1', latest_charge: { id: 'ch_1', balance_transaction: { fee } } });
};

test('fee is written to stripe_fee_cents, never processing_fee_cents', async () => {
  const mod = loadFeeModule(stripeFee(175));
  const db = fakeDb([{ id: 'o1', type: 'event_ticket', total_cents: 5000, processing_fee_cents: 0,
    stripe_fee_cents: null, stripe_payment_intent_id: 'pi_1', stripe_checkout_session_id: 'cs_1' }]);
  const fee = await mod.syncOrderStripeProcessingFee(db, 'sk', { checkoutSessionId: 'cs_1', paymentIntentId: 'pi_1' });
  assert.equal(fee, 175);
  assert.equal(db.rows[0].stripe_fee_cents, 175);
  assert.equal(db.rows[0].processing_fee_cents, 0, 'buyer-facing Processing line untouched');
  assert.ok(db.updates.every(u => !('processing_fee_cents' in u)));
});

test('one PaymentIntent paying several orders splits the fee pro rata, remainder to the last', async () => {
  const mod = loadFeeModule(stripeFee(100));
  const base = { type: 'event_ticket', stripe_fee_cents: null, stripe_payment_intent_id: 'pi_1' };
  const db = fakeDb([
    { ...base, id: 'a', total_cents: 1000 },
    { ...base, id: 'b', total_cents: 1000 },
    { ...base, id: 'c', total_cents: 1000 },
  ]);
  const fee = await mod.syncOrderStripeProcessingFee(db, 'sk', { paymentIntentId: 'pi_1' });
  assert.equal(fee, 100);
  assert.deepEqual(db.rows.map(r => r.stripe_fee_cents), [33, 33, 34]);
});

test('allocation is integer cents, weighted by total, and always sums to the fee', () => {
  const { allocateStripeFeeCents } = loadFeeModule(async () => { throw new Error('no fetch'); });
  assert.deepEqual(
    allocateStripeFeeCents(301, [{ id: 'a', total_cents: 7500 }, { id: 'b', total_cents: 2500 }])
      .map(p => p.feeCents),
    [225, 76],
  );
  for (const [fee, totals] of [[1, [1, 1, 1]], [999, [3, 7, 11, 0]], [0, [5, 5]], [17, [0, 0]]]) {
    const parts = allocateStripeFeeCents(fee, totals.map((t, i) => ({ id: String(i), total_cents: t })));
    assert.equal(parts.reduce((s, p) => s + p.feeCents, 0), fee);
    assert.ok(parts.every(p => Number.isInteger(p.feeCents) && p.feeCents >= 0));
  }
});

test('already-synced orders do not call Stripe again', async () => {
  let calls = 0;
  const mod = loadFeeModule(async () => { calls++; return Response.json({}); });
  const db = fakeDb([{ id: 'o1', type: 'event_ticket', total_cents: 5000, stripe_fee_cents: 0,
    stripe_payment_intent_id: 'pi_1' }]);
  assert.equal(await mod.syncOrderStripeProcessingFee(db, 'sk', { paymentIntentId: 'pi_1' }), null);
  assert.equal(calls, 0);
});

test('safe wrapper swallows a throwing fetch', async () => {
  const mod = loadFeeModule(async () => { throw new TypeError('network down'); });
  const db = fakeDb([{ id: 'o1', type: 'event_ticket', total_cents: 5000, stripe_fee_cents: null,
    stripe_payment_intent_id: 'pi_1' }]);
  await assert.rejects(mod.syncOrderStripeProcessingFee(db, 'sk', { paymentIntentId: 'pi_1' }));
  assert.equal(await mod.syncOrderStripeProcessingFeeSafely(db, 'sk', { paymentIntentId: 'pi_1' }), null);
});

test('webhook: paid cart issues tickets and returns 200 even when the Stripe fee read throws', async () => {
  let issued = false;
  let stripeCallsBeforeIssuance = 0;
  const h = harness({
    stripeFetch: async () => { if (!issued) stripeCallsBeforeIssuance++; throw new TypeError('network down'); },
    database: {
      from() {
        const q = { select: () => q, eq: () => q, is: () => q, order: () => q, insert: () => q,
          update: () => q, single: async () => ({ data: null, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          then: (res, rej) => Promise.resolve({ data: [{ id: 'order', stripe_payment_intent_id: 'pi_ok',
            total_cents: 5000, stripe_fee_cents: null }], error: null }).then(res, rej) };
        return q;
      },
    },
    dependencyOverrides: {
      'cart-issuance.ts': { handleCartPaymentIntentSucceeded: async () => { issued = true; return true; } },
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: 'evt_ok', type: 'payment_intent.succeeded', created: timestamp,
    data: { object: { id: 'pi_ok', metadata: { type: 'cart_checkout', cart_id: 'cart', event_id: '1' } } } });
  const signature = createHmac('sha256', 'test').update(`${timestamp}.${body}`).digest('hex');
  const r = await h.invoke('stripe-webhook', body, { 'stripe-signature': `t=${timestamp},v1=${signature}` });
  assert.equal(r.status, 200, await r.text());
  assert.ok(issued);
  assert.equal(stripeCallsBeforeIssuance, 0, 'fee read never runs ahead of issuance');
  assert.equal(h.requests.length, 1, 'fee read was attempted after issuance');
});
