// Real handler; all database, identity, and Stripe boundaries are synthetic.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ ticket = {}, sourceTier = {}, targetTier = {}, actor = 'fixture-buyer', missingSource = false } = {}) {
  let handler;
  const calls = [], stripe = [], writes = [];
  const credential = { id: 'fixture-ticket', event_id: 7, user_id: 'fixture-buyer', ticket_type_id: 'fixture-ga', purchase_amount_cents: 1000, status: 'active', category: 'admission', ...ticket };
  const tables = {
    tickets: [credential],
    ticket_types: [
      ...(!missingSource ? [{ id: 'fixture-ga', event_id: 7, category: 'admission', ...sourceTier }] : []),
      { id: 'fixture-vip', event_id: 7, category: 'admission', price_cents: 3000, name: 'Synthetic VIP', is_active: true, quantity_total: 100, quantity_sold: 1, ...targetTier },
    ],
    events: [{ id: 7, start_date: '2099-01-01T12:00:00Z', end_date: '2099-01-01T20:00:00Z' }],
    stripe_customers: [{ user_id: 'fixture-buyer', stripe_customer_id: 'cus_synthetic' }],
  };
  const before = JSON.stringify(credential);
  const db = { from(table) {
    const predicates = [];
    const q = {
      select(columns) { calls.push({ table, columns }); return q; },
      eq(key, value) { predicates.push(r => r[key] === value); return q; },
      async single() { const rows = tables[table].filter(r => predicates.every(p => p(r))); return { data: rows.length === 1 ? rows[0] : null, error: rows.length === 1 ? null : { code: 'PGRST116' } }; },
      maybeSingle() { return q.single(); },
      update(value) { writes.push(value); throw Error('Unexpected mutation'); },
      upsert(value) { writes.push(value); throw Error('Unexpected mutation'); },
    };
    return q;
  } };
  vm.runInNewContext(source, {
    exports: {}, Request, Response, URLSearchParams, console,
    Deno: { env: { get: () => 'synthetic-config' }, serve: fn => { handler = fn; } },
    fetch: async (url, options) => {
      stripe.push({ url, body: new URLSearchParams(options.body) });
      return { json: async () => url.endsWith('/ephemeral_keys') ? { secret: 'synthetic-ephemeral' } : { id: 'pi_synthetic', client_secret: 'synthetic-secret' } };
    },
    require(name) {
      if (name.includes('supabase-js')) return { createClient: () => db };
      if (name.endsWith('verify-session.ts')) return { verifySession: async () => actor };
      if (name.endsWith('fee-calculator.ts')) return { computeFees: amount => ({ customer_charge_amount: amount + 100, buyer_fee: 100, fee_policy_version: 'fixture' }) };
      if (name.endsWith('tier-visibility.ts')) return { enforceTierVisibility: async () => null, TIER_VISIBILITY_MESSAGES: {} };
      if (name.endsWith('sales-cutoff.ts')) return { isSalesClosed: () => false };
      throw Error(name);
    },
  });
  return { stripe, writes, calls, async call() {
    const response = await handler(new Request('https://fixture.test/ticket-upgrade', { method: 'POST', body: JSON.stringify({ ticket_id: 'fixture-ticket', new_ticket_type_id: 'fixture-vip' }) }));
    assert.equal(JSON.stringify(credential), before, 'original credential unchanged');
    return { status: response.status, body: await response.json() };
  } };
}
for (const category of ['service', 'coat_check', 'product', 'unknown']) {
  test(`${category} source ticket cannot be replaced by admission`, async () => {
    const f = fixture({ ticket: { category } }); const r = await f.call();
    assert.equal(r.status, 400); assert.equal(r.body.code, 'admission_upgrade_only'); assert.equal(f.stripe.length, 0); assert.equal(f.writes.length, 0);
  });
  test(`${category} authoritative source tier blocks a legacy admission-stamped ticket`, async () => {
    const f = fixture({ sourceTier: { category } }); const r = await f.call();
    assert.equal(r.status, 400); assert.equal(r.body.code, 'admission_upgrade_only'); assert.equal(f.stripe.length, 0);
  });
  test(`${category} target must be bought separately, never replaces admission`, async () => {
    const f = fixture({ targetTier: { category } }); const r = await f.call();
    assert.equal(r.status, 400); assert.equal(r.body.code, 'admission_upgrade_only'); assert.equal(f.stripe.length, 0);
  });
}
test('missing or foreign-event source tier fails closed before Stripe', async () => {
  for (const options of [{ missingSource: true }, { sourceTier: { event_id: 8 } }]) {
    const f = fixture(options); const r = await f.call(); assert.equal(r.status, 400); assert.equal(f.stripe.length, 0);
  }
});
for (const paid of [0, 1000]) test(`admission upgrade preserves price difference from ${paid} cents`, async () => {
  const f = fixture({ ticket: { purchase_amount_cents: paid } }); const r = await f.call();
  assert.equal(r.status, 200); assert.equal(r.body.diff_cents, 3000 - paid); assert.equal(f.stripe.length, 2);
  assert.equal(f.stripe[0].body.get('metadata[ticket_id]'), 'fixture-ticket'); assert.equal(f.writes.length, 0);
});
test('legacy nullish admission categories and untiered admission keep existing upgrade path', async () => {
  for (const options of [{ ticket: { category: null }, sourceTier: { category: null }, targetTier: { category: null } }, { ticket: { ticket_type_id: null, category: undefined } }]) {
    const f = fixture(options); assert.equal((await f.call()).status, 200); assert.equal(f.stripe.length, 2);
  }
});
test('ownership, active status, inventory and price protections remain', async () => {
  for (const [options, status] of [[{ actor: null }, 401], [{ actor: 'other-buyer' }, 403], [{ ticket: { status: 'scanned' } }, 400], [{ targetTier: { quantity_sold: 100 } }, 400], [{ targetTier: { price_cents: 500 } }, 400], [{ targetTier: { is_active: false } }, 400]]) {
    const f = fixture(options); assert.equal((await f.call()).status, status); assert.equal(f.stripe.length, 0);
  }
});
