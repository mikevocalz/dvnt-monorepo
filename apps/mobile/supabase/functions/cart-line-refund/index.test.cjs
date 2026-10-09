// Add-on refunds through cart-line-refund and the stripe-webhook
// charge.refunded path. The SQL side (order_addons flip, stock return) is
// asserted against real Postgres in scripts/verify-event-consolidation.mjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHmac } = require('node:crypto');
const ts = require('typescript');
const { harness } = require('../_shared/payment-safety.test.cjs');

const CART = '00000000-0000-4000-8000-000000000001';
const TICKET_LINE = '00000000-0000-4000-8000-0000000000a1';
const ADDON_LINE = '00000000-0000-4000-8000-0000000000b1';

// Fake service-role client. Each read resolves to the rows `tables` lists for
// that table, filtered by the .eq() calls the handler made.
function fakeDb(tables) {
  const reads = [], rpcs = [];
  return {
    reads, rpcs,
    from(table) {
      const filters = {};
      let mode = 'select';
      const rows = () => (tables[table] || []).filter(row =>
        Object.entries(filters).every(([k, v]) => row[k] === undefined || row[k] === v));
      const q = {
        select: () => q, update: () => { mode = 'update'; return q; },
        insert: () => { mode = 'insert'; return q; },
        eq: (k, v) => { filters[k] = v; return q; }, in: () => q, is: () => q,
        maybeSingle: async () => { reads.push({ table, filters: { ...filters } }); return { data: rows()[0] ?? null, error: null }; },
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve, reject) => {
          if (mode === 'select') reads.push({ table, filters: { ...filters } });
          return Promise.resolve({ data: mode === 'select' ? rows() : null, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, args) {
      rpcs.push({ name, args });
      return { data: { ok: true, ticketRows: [], addonRows: [] }, error: null };
    },
  };
}

function loadRefund(db) {
  let handler;
  const stripe = [];
  const stubs = {
    'verify-session.ts': {
      verifySession: async () => 'buyer',
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      errorResponse: (error, status = 400) => Response.json({ error }, { status }),
      optionsResponse: () => new Response(null),
    },
    'notify-waitlisters.ts': { notifyNextWaitlister: async () => {} },
    'wallet-push.ts': { voidWalletPass: async () => {} },
  };
  const file = path.resolve(__dirname, 'index.ts');
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: {}, Response, Request, URLSearchParams, console: { log() {}, error() {}, warn() {} },
    Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
    fetch: async (url, init) => {
      stripe.push({ url, body: new URLSearchParams(init.body) });
      return Response.json({ id: 're_test' });
    },
    require: name => name.includes('supabase-js') ? { createClient: () => db } : stubs[path.basename(name)],
  });
  return {
    stripe,
    invoke: lineItemId => handler(new Request('http://test', { method: 'POST',
      body: JSON.stringify({ cartId: CART, lineItemId }) })),
  };
}

function cartTables(extra) {
  return {
    carts: [{ id: CART, user_id: 'buyer', event_id: 1, status: 'completed', stripe_pi_id: 'pi_cart' }],
    events: [{ id: 1, start_date: new Date(Date.now() + 7 * 864e5).toISOString() }],
    cart_line_items: [
      { id: TICKET_LINE, cart_id: CART, category: 'admission', tier_id: 'tier', addon_id: null,
        quantity: 1, unit_price_cents: 2500, refunded_amount_cents: 0 },
      { id: ADDON_LINE, cart_id: CART, category: 'addon', tier_id: null, addon_id: 'coat',
        quantity: 2, unit_price_cents: 500, refunded_amount_cents: 0 },
    ],
    cart_line_refunds: [],
    ...extra,
  };
}

test('add-on line refunds through Stripe and cart_apply_line_refund', async () => {
  const db = fakeDb(cartTables({
    tickets: [],
    order_addons: [{ id: 'oa1', cart_id: CART, cart_line_item_id: ADDON_LINE, status: 'unfulfilled' }],
  }));
  const fn = loadRefund(db);
  const r = await fn.invoke(ADDON_LINE);
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(fn.stripe.length, 1);
  assert.equal(fn.stripe[0].body.get('amount'), '1000');
  assert.equal(fn.stripe[0].body.get('metadata[cart_line_item_id]'), ADDON_LINE);
  const apply = db.rpcs.find(c => c.name === 'cart_apply_line_refund');
  assert.deepEqual(
    { line: apply.args.p_line_item_id, amount: apply.args.p_amount_cents },
    { line: ADDON_LINE, amount: 1000 });
  assert.ok(db.reads.some(r => r.table === 'order_addons'
    && r.filters.cart_line_item_id === ADDON_LINE), 'checked order_addons for the line');
});

test('a redeemed add-on is refused with 409 before Stripe is called', async () => {
  const db = fakeDb(cartTables({
    tickets: [],
    order_addons: [{ id: 'oa1', cart_id: CART, cart_line_item_id: ADDON_LINE, status: 'redeemed' }],
  }));
  const fn = loadRefund(db);
  const r = await fn.invoke(ADDON_LINE);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /already been used/);
  assert.equal(fn.stripe.length, 0);
  assert.equal(db.rpcs.length, 0);
});

test('an add-on line with nothing left to refund is refused with 409', async () => {
  const db = fakeDb(cartTables({
    tickets: [],
    order_addons: [{ id: 'oa1', cart_id: CART, cart_line_item_id: ADDON_LINE, status: 'refunded' }],
  }));
  const fn = loadRefund(db);
  const r = await fn.invoke(ADDON_LINE);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /No refundable add-on/);
  assert.equal(fn.stripe.length, 0);
});

test('ticket lines still require an active ticket', async () => {
  const live = loadRefund(fakeDb(cartTables({
    tickets: [{ id: 't1', cart_id: CART, cart_line_item_id: TICKET_LINE, status: 'active' }],
  })));
  assert.equal((await live.invoke(TICKET_LINE)).status, 200);
  assert.equal(live.stripe[0].body.get('amount'), '2500');

  const gone = loadRefund(fakeDb(cartTables({ tickets: [] })));
  const r = await gone.invoke(TICKET_LINE);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /No active tickets/);
  assert.equal(gone.stripe.length, 0);
});

// stripe-webhook charge.refunded with no line metadata (organizer-refund,
// event-cancel, dashboard). The payment-safety harness answers carts with
// { id: 'cart' }.
async function chargeRefunded({ amount, amountRefunded, refundMetadata = {} }) {
  const h = harness({ dependencyOverrides: {
    'order-state.ts': { upsertOrderMoneyState: async () => {}, recordPromoterReversal: async () => {},
      recordPromoterEarning: async () => {} },
    'wallet-push.ts': { voidWalletPass: async () => {} },
    'notify-waitlisters.ts': { notifyNextWaitlister: async () => {} },
  } });
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: 'evt_refund', type: 'charge.refunded', created: timestamp,
    data: { object: { payment_intent: 'pi_cart', amount, amount_refunded: amountRefunded,
      refunds: { data: [{ id: 're_1', amount: amountRefunded, metadata: refundMetadata }] } } } });
  const signature = createHmac('sha256', 'test').update(`${timestamp}.${body}`).digest('hex');
  const r = await h.invoke('stripe-webhook', body, { 'stripe-signature': `t=${timestamp},v1=${signature}` });
  return { r, h };
}

test('webhook: a full charge refund refunds the cart add-ons', async () => {
  const { r, h } = await chargeRefunded({ amount: 3500, amountRefunded: 3500 });
  assert.equal(r.status, 200, await r.clone().text());
  const call = h.calls.find(c => c.name === 'refund_order_addons_for_cart');
  assert.ok(call, 'refund_order_addons_for_cart was not called');
  assert.equal(call.args.p_cart_id, 'cart');
});

test('webhook: a full refund scoped to one ticket still refunds the add-ons', async () => {
  // organizer-refund refunds the whole PaymentIntent but names one ticket.
  const { h } = await chargeRefunded({ amount: 3500, amountRefunded: 3500,
    refundMetadata: { ticket_id: 't1' } });
  assert.ok(h.calls.some(c => c.name === 'refund_order_addons_for_cart'));
});

test('webhook: a partial refund leaves add-ons alone', async () => {
  const { r, h } = await chargeRefunded({ amount: 3500, amountRefunded: 2500,
    refundMetadata: { ticket_id: 't1' } });
  assert.equal(r.status, 200);
  assert.ok(!h.calls.some(c => c.name === 'refund_order_addons_for_cart'));
});
