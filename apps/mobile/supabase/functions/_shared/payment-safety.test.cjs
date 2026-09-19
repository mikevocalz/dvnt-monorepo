const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHmac } = require('node:crypto');
const ts = require('typescript');

function harness(config = {}) {
  let handler;
  const writes = [], calls = [], requests = [];
  const tier = { id: 'tier', event_id: 1, name: 'General Admission', price_cents: 5000,
    currency: 'usd', quantity_total: 100, quantity_sold: 0, max_per_user: 20, ...config.tier };
  const client = { from(table) {
    let payload, operation;
    const result = () => {
      if (operation) writes.push({ table, operation, payload });
      const data = table === 'ticket_types' ? tier
        : table === 'events' ? { host_id: 'staff', title: 'Test', fee_mode: config.feeMode || 'pass' }
        : table === 'organizer_accounts' ? { stripe_account_id: config.organizerAccountId || 'acct_test', charges_enabled: true }
        : table === 'event_promoters' ? { id: 'promoter', code: 'CODE', status: 'active',
            customer_discount_bps: config.discountBps || 0, promoter_commission_bps: 1000 }
        : table === 'carts' ? { id: 'cart', user_id: 'staff', event_id: 1, status: 'holding', currency: 'usd', idempotency_key: 'test' }
        : table === 'cart_line_items' && config.cart ? [{ id: 'line', tier_id: 'tier', category: 'admission', quantity: 2, ticket_types: tier }]
        : table === 'cart_holds' ? [{ line_item_id: 'line', expires_at: new Date(Date.now() + 600000).toISOString() }]
        : table === 'orders' ? { id: 'order' }
        : table === 'tickets' && operation === 'insert' ? payload
        : [];
      return { data, count: 0, error: null };
    };
    const q = { select: () => q, eq: () => q, gt: () => q, in: () => q, ilike: () => q, not: () => q, order: () => q,
      insert: p => { payload = p; operation = 'insert'; return q; },
      upsert: p => { payload = p; operation = 'upsert'; return q; },
      update: p => { payload = p; operation = 'update'; return q; },
      single: async () => result(), maybeSingle: async () => result(),
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject) };
    return q;
  }, async rpc(name, args) {
    calls.push({ name, args });
    if (name === 'door_free_sale_atomic') return config.rpcError
      ? { error: { message: 'RPC unavailable' } }
      : { data: config.soldOut ? { ok: false } : { ok: true, order_id: 'order', tickets: args.p_ticket_rows } };
    if (name === 'ticket_hold_create_atomic' && config.soldOut) return { data: { ok: false, available: 0 } };
    if (name === 'cart_complete_issuance') return config.rpcError
      ? { error: { message: 'issuance failed' } } : { data: { ok: false, error: 'hold_expired' } };
    return { data: { ok: true } };
  }};
  const stubs = {
    'verify-session.ts': { verifySession: async () => config.unauthenticated ? null : 'staff', corsHeaders: () => ({}), jsonResponse: (data, status = 200) => Response.json(data, { status }), errorResponse: (error, status = 400) => Response.json({ error }, { status }) },
    'event-access.ts': { canAccessEvent: async () => true },
    'verified-admission.ts': { resolveVerifiedAdmission: async () => ({ state: 'allowed' }) },
    'tier-visibility.ts': { enforceTierVisibility: async () => null },
    'rate-limit.ts': { checkRateLimit: () => ({ allowed: true }) },
    'apply-promo-code.ts': { validateAndApplyPromo: async () => ({ result: { discount_cents: config.promoDiscount || 0,
      promo_code_id: 'promo', code: 'PROMO' } }), incrementPromoUsage: async () => {} },
    'capacity-alerts.ts': { maybeFireCapacityAlerts: async () => {} },
    'hmac-qr.ts': { createSignedQrPayload: async () => ({ qrToken: crypto.randomUUID(), qrPayload: 'signed' }) },
    'session-issuance.ts': { sendGuestTicketEmail: async () => {} },
    'sentry.ts': { withSentry: (_name, fn) => fn },
    'order-state.ts': {},
    'notify-event-organizers.ts': {}, 'notify-waitlisters.ts': {}, 'wallet-push.ts': {},
    ...config.dependencyOverrides,
  };
  function load(filename) {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { exports, Response, Request, URLSearchParams, crypto, TextEncoder,
      console: { log() {}, error() {}, warn() {} },
      Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
      fetch: async (url, init) => { requests.push({ url, body: new URLSearchParams(init.body) });
        assert.ok(!url.includes('/refunds'), 'must never refund a paid cart on issuance failure');
        if (config.stripeFetch) return config.stripeFetch(url, init);
        return Response.json({ id: 'cs_test', url: 'https://checkout.test' }); },
      require: name => name.includes('supabase-js') ? { createClient: () => config.database || client }
        : stubs[path.basename(name)] || load(path.resolve(path.dirname(filename), name)),
    });
    return exports;
  }
  return { writes, calls, requests, load,
    async invoke(fn, body, headers = {}) {
      load(path.resolve(__dirname, '..', fn, 'index.ts'));
      return handler(new Request('http://test', { method: 'POST', headers,
        body: typeof body === 'string' ? body : JSON.stringify(body) }));
    } };
}

module.exports = { harness };

if (require.main === module) {
for (const c of [
  { name: 'ordinary checkout unchanged', expected: 5000 },
  { name: 'ordinary promo reduces actual Stripe charge', promoDiscount: 500, promo_code: 'PROMO', expected: 4500 },
  { name: 'promoter and promo stack once', discountBps: 1000, promoter_code: 'CODE', promoDiscount: 500, promo_code: 'PROMO', expected: 4000 },
  { name: 'remainder cents preserved', tier: { price_cents: 333 }, quantity: 3, discountBps: 1500, promoter_code: 'CODE', expected: 850 },
  { name: 'legacy promoter remains attribution-only', promoter_code: 'CODE', expected: 5000 },
  { name: 'absorb fees preserve discounted ticket price', feeMode: 'absorb', promoDiscount: 500, promo_code: 'PROMO', expected: 4500 },
]) test(c.name, async () => {
  const h = harness(c);
  const response = await h.invoke('ticket-checkout', { event_id: 1, ticket_type_id: 'tier', quantity: c.quantity || 1,
    promo_code: c.promo_code, promoter_code: c.promoter_code });
  assert.equal(response.status, 200, await response.text());
  const params = h.requests[0].body;
  let admission = 0, amount = 0, ticketCount = 0;
  for (let i = 0; params.has(`line_items[${i}][quantity]`); i++) {
    const qty = Number(params.get(`line_items[${i}][quantity]`));
    const total = qty * Number(params.get(`line_items[${i}][price_data][unit_amount]`));
    amount += total;
    if (params.get(`line_items[${i}][price_data][product_data][name]`) === 'General Admission') {
      admission += total; ticketCount += qty;
    }
  }
  const order = h.writes.find(w => w.table === 'orders').payload;
  assert.equal(admission, c.expected);
  assert.equal(ticketCount, c.quantity || 1);
  assert.equal(order.subtotal_cents, admission);
  assert.equal(order.total_cents, amount);
  assert.equal(Number(params.get('metadata[subtotal_cents]')), admission);
});

for (const mode of ['pass', 'absorb']) test(`free door quote has zero fees (${mode})`, async () => {
  const h = harness({ tier: { price_cents: 0 }, feeMode: mode });
  const r = await h.invoke('door-sell', { action: 'quote', event_id: 1, ticket_type_id: 'tier' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).quote.total_cents, 0);
  assert.equal(h.writes.length, 0); assert.equal(h.requests.length, 0);
});
for (const scenario of [{}, { soldOut: true }, { rpcError: true }]) test(`free door transaction ${JSON.stringify(scenario)}`, async () => {
  const h = harness({ tier: { price_cents: 0 }, ...scenario });
  const r = await h.invoke('door-sell', { action: 'sell', event_id: 1, ticket_type_id: 'tier', guest_email: 'buyer@test.co' });
  assert.equal(r.status, scenario.soldOut ? 409 : scenario.rpcError ? 500 : 200);
  assert.equal(h.calls[0].name, 'door_free_sale_atomic');
  assert.equal(h.calls[0].args.p_order.sold_by_staff_user_id, 'staff');
  assert.equal(h.calls[0].args.p_ticket_rows[0].user_id, null);
  assert.equal(h.writes.length, 0, 'no nontransactional inventory/order/ticket writes');
  assert.equal(h.requests.length, 0, 'free sale never calls Stripe');
});
for (const rpcError of [false, true]) test(`signed webhook issuance failure stays retryable without refund (RPC error=${rpcError})`, async () => {
  const h = harness({ rpcError });
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: 'evt_test', type: 'payment_intent.succeeded', created: timestamp,
    data: { object: { id: 'pi_old', metadata: { type: 'cart_checkout', cart_id: 'cart', event_id: '1' } } } });
  const signature = createHmac('sha256', 'test').update(`${timestamp}.${body}`).digest('hex');
  const r = await h.invoke('stripe-webhook', body, { 'stripe-signature': `t=${timestamp},v1=${signature}` });
  assert.equal(r.status, 500);
  assert.ok(h.calls.some(c => c.name === 'cart_complete_issuance'));
  assert.equal(h.requests.length, 0);
  assert.ok(!h.writes.some(w => w.table === 'stripe_events' && w.payload.processed_at));
});

for (const fn of ['create-payment-intent', 'cart-checkout']) {
  for (const discountBps of [0, 1000]) test(`${fn}: multi-ticket promoter ${discountBps}bps charges subtotal once`, async () => {
    const h = harness({ cart: fn === 'cart-checkout', discountBps });
    const r = await h.invoke(fn, fn === 'cart-checkout'
      ? { cartId: '00000000-0000-4000-8000-000000000001', promoterCode: 'CODE' }
      : { event_id: 1, ticket_type_id: 'tier', quantity: 2, promoter_code: 'CODE' });
    assert.equal(r.status, 200, await r.text());
    const order = h.writes.find(w => w.table === 'orders').payload;
    const request = h.requests.find(r => r.url.endsWith('/payment_intents'));
    assert.equal(order.subtotal_cents, discountBps ? 9000 : 10000);
    assert.equal(order.promoter_commission_amount_cents, discountBps ? 900 : 1000);
    assert.equal(Number(request.body.get('amount')), order.total_cents);
  });
}

test('older promoter-management client creates attribution without a customer discount', async () => {
  const h = harness();
  const r = await h.invoke('manage-promoters', { action: 'add', event_id: 1,
    display_name: 'Legacy promoter', code: 'LEGACY', rev_share_bps: 1500 });
  assert.equal(r.status, 200, await r.text());
  const row = h.writes.find(w => w.table === 'event_promoters').payload;
  assert.equal(row.customer_discount_bps, 0);
  assert.equal(row.promoter_commission_bps, 1500);
});

test('hosted checkout reserves against the same atomic inventory as door sales', async () => {
  const h = harness();
  const r = await h.invoke('ticket-checkout', { event_id: 1, ticket_type_id: 'tier', quantity: 2 });
  assert.equal(r.status, 200);
  const hold = h.calls.find(c => c.name === 'ticket_hold_create_atomic');
  assert.equal(hold.args.p_quantity, 2);
  assert.equal(hold.args.p_payment_intent_id, 'cs_test');
  assert.ok(!h.writes.some(w => w.table === 'ticket_holds' && w.operation === 'insert'));
});

test('hosted checkout expires its Stripe session when the last seat is gone', async () => {
  const h = harness({ soldOut: true });
  const r = await h.invoke('ticket-checkout', { event_id: 1, ticket_type_id: 'tier', quantity: 1 });
  assert.equal(r.status, 409);
  assert.ok(h.requests.some(r => r.url.endsWith('/checkout/sessions/cs_test/expire')));
  assert.ok(!h.writes.some(w => w.table === 'orders'));
});

}
