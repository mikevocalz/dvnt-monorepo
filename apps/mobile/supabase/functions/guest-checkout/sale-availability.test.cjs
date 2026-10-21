const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, promo } = require('./discounts-fixture.cjs');

const NOW = Date.parse('2026-10-21T12:00:00Z');
const blocked = [
  ['inactive', { is_active: false }, 'tier_unavailable'],
  ...['draft', 'scheduled', 'paused', 'ended', 'unknown', ''].map(status =>
    [`status ${status || 'empty'}`, { status }, 'tier_unavailable']),
  ['sold-out status', { status: 'sold_out' }, 'sold_out'],
  ['legacy sold-out flag', { is_sold_out: true }, 'sold_out'],
  ['before opening', { sale_start: new Date(NOW + 1).toISOString() }, 'sale_not_started'],
  ['at closing', { sale_end: new Date(NOW).toISOString() }, 'sale_ended'],
  ['after closing', { sale_end: new Date(NOW - 1).toISOString() }, 'sale_ended'],
  ['malformed start', { sale_start: 'invalid' }, 'invalid_sale_window'],
  ['malformed end', { sale_end: 'invalid' }, 'invalid_sale_window'],
  ['infinite start', { sale_start: '-infinity' }, 'invalid_sale_window'],
  ['infinite end', { sale_end: 'infinity' }, 'invalid_sale_window'],
  ['empty window', { sale_start: new Date(NOW).toISOString(), sale_end: new Date(NOW).toISOString() }, 'invalid_sale_window'],
  ['reversed window', { sale_start: new Date(NOW + 1).toISOString(), sale_end: new Date(NOW - 1).toISOString() }, 'invalid_sale_window'],
];
const modes = [
  ['paid', {}, {}],
  ['free RSVP', { event: { ticketing_enabled: false }, tier: { price_cents: 0 }, noStripe: true }, {}],
  ['100% promo', { promos: [promo({ discount_value: 100 })] }, { discount_code: 'SAVE10' }],
];
function untouched(f) {
  assert.equal(f.writes.length, 0, 'No holds, atomic issuance, orders, or inventory writes');
  assert.equal(f.stripe.length, 0, 'No Stripe session');
  assert.equal(f.qr.length, 0, 'No QR signing');
  assert.equal(f.emails.length, 0, 'No mail');
  assert.equal(f.tables.orders.length, 0);
  assert.equal(f.tables.tickets.length, 0);
}
for (const [mode, options, body] of modes) {
  for (const [label, patch, code] of blocked) {
    test(`guest ${mode}: ${label} rejects quote and checkout before side effects`, async () => {
      const f = fixture({ ...options, now: NOW, projectSelect: true, tier: { ...options.tier, ...patch } });
      for (const result of [await f.quote(body), await f.pay(body)]) {
        assert.equal(result.data.ok, false, JSON.stringify(result.data));
        assert.equal(result.data.error.code, code);
      }
      untouched(f);
    });
    test(`guest ${mode}: a reviewed quote cannot override ${label}`, async () => {
      const f = fixture({ ...options, now: NOW, projectSelect: true });
      const q = await f.quote(body);
      assert.equal(q.data.ok, true);
      Object.assign(f.tables.ticket_types[0], patch);
      const result = await f.pay({ ...body, expected_quote_key: q.data.quote.quote_key });
      assert.equal(result.data.ok, false, JSON.stringify(result.data));
      assert.equal(result.data.error.code, code);
      untouched(f);
    });
  }
  for (const [label, patch] of [
    ['on-sale window', { sale_start: new Date(NOW - 1).toISOString(), sale_end: new Date(NOW + 1).toISOString() }],
    ['exact opening', { sale_start: new Date(NOW).toISOString() }],
    ['legacy nulls', { status: null, is_active: null, is_sold_out: null, sale_start: null, sale_end: null }],
    ['omitted legacy flags', { status: undefined, is_active: undefined, is_sold_out: undefined }],
  ]) {
    test(`guest ${mode}: ${label} preserves valid checkout`, async () => {
      const f = fixture({ ...options, now: NOW, projectSelect: true, tier: { ...options.tier, ...patch } });
      const q = await f.quote(body);
      assert.equal(q.data.ok, true, JSON.stringify(q.data));
      untouched(f);
      const result = await f.pay({ ...body, expected_quote_key: q.data.quote.quote_key });
      assert.equal(result.data.ok, true, JSON.stringify(result.data));
      assert.equal(f.stripe.length, mode === 'paid' ? 1 : 0);
      assert.equal(f.tables.tickets.length, mode === 'paid' ? 0 : 1);
      assert.equal(f.writes.filter(w => w.fn === 'guest_free_checkout_atomic').length, mode === 'paid' ? 0 : 1);
    });
  }
}
test('hidden and locked tiers keep visibility errors ahead of sale status', async () => {
  for (const visibility of ['hidden', 'locked']) {
    const f = fixture({ now: NOW, projectSelect: true, tier: { status: 'paused', tier_visibility: visibility } });
    assert.equal((await f.quote()).data.error.code, `tier_${visibility}`);
    assert.equal((await f.pay()).data.error.code, `tier_${visibility}`);
    untouched(f);
  }
});
