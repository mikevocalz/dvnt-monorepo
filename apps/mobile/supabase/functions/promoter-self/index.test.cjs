const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(source, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, ...mocks });
  return exports;
}

function harness({ ledger = [], attributions = [], failure, cap = 1000,
  userId = 'member', promoter = { id: 'promoter', event_id: 42, user_id: 'member', status: 'active' },
  missingCount = false } = {}) {
  let handler;
  const queries = [];
  const client = {
    from(table) {
      const filters = [];
      let selected, options, cursor, limit = cap;
      const query = {
        select(columns, opts) { selected = columns; options = opts; return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        neq(key, value) { filters.push(row => row[key] !== value); return query; },
        order(key) { cursor = key; return query; },
        limit(value) { limit = Math.min(value, cap); return query; },
        gt(key, value) { filters.push(row => row[key] > value); return query; },
        maybeSingle() { return query.then(result => ({ ...result, data: result.data?.[0] ?? null })); },
        then(resolve, reject) {
          queries.push({ table, selected, options });
          const failed = failure === table || (failure === 'second-ledger-page' &&
            table === 'promoter_ledger_entries' && queries.filter(q => q.table === table).length > 1);
          if (failed) return Promise.resolve({ data: null, count: null, error: { message: 'database unavailable' } }).then(resolve, reject);
          // Model the actual attribution schema: it has order_id, never id.
          if (table === 'promoter_attributions' && selected !== 'order_id') {
            return Promise.resolve({ data: null, count: null, error: { code: '42703' } }).then(resolve, reject);
          }
          let rows = (table === 'event_promoters' ? (promoter ? [promoter] : [])
            : table === 'promoter_ledger_entries' ? ledger : attributions).filter(row => filters.every(f => f(row)));
          if (cursor) rows = [...rows].sort((a, b) => a[cursor] < b[cursor] ? -1 : 1);
          return Promise.resolve({
            data: options?.head ? null : rows.slice(0, limit),
            count: options?.count === 'exact' && !missingCount ? rows.length : null,
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const shared = load(fs.readFileSync(__dirname + '/../_shared/read-all-rows.ts', 'utf8'), {});
  load(fs.readFileSync(__dirname + '/index.ts', 'utf8'), {
    console: { error() {} }, Response,
    Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
    require: name => {
      if (name.includes('supabase-js')) return { createClient: () => client };
      if (name.includes('verify-session')) return { verifySession: async () => userId };
      if (name.includes('read-all-rows')) return shared;
      if (name.includes('sentry')) return { withSentry: (_name, fn) => fn };
      throw new Error('Unexpected import: ' + name);
    },
  });
  return {
    queries,
    async call(body = { action: 'me', event_id: 42 }) {
      const response = await handler(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('counts actual order_id attributions, scoped to the authenticated promoter', async () => {
  const h = harness({
    attributions: [
      { order_id: 'order-1', promoter_id: 'promoter' },
      { order_id: 'order-2', promoter_id: 'promoter' },
      { order_id: 'order-3', promoter_id: 'other-promoter' },
    ],
    ledger: [
      { id: '1', promoter_id: 'promoter', amount_cents: 1500 },
      { id: '2', promoter_id: 'promoter', amount_cents: -200 },
      { id: '3', promoter_id: 'other-promoter', amount_cents: 9000 },
    ],
  });
  const result = await h.call();
  assert.equal(result.status, 200);
  assert.equal(result.body.promoter.attributedOrders, 2);
  assert.equal(result.body.promoter.earnedCents, 1300);
  assert.deepEqual({ ...h.queries.find(q => q.table === 'promoter_attributions').options }, { count: 'exact', head: true });
});

test('returns genuine zero counts and earnings for an empty ledger', async () => {
  const result = await harness().call();
  assert.equal(result.status, 200);
  assert.equal(result.body.promoter.attributedOrders, 0);
  assert.equal(result.body.promoter.earnedCents, 0);
});

test('includes earnings and reversals beyond the server row cap', async () => {
  const result = await harness({
    cap: 2,
    ledger: [
      { id: '1', promoter_id: 'promoter', amount_cents: 100 },
      { id: '2', promoter_id: 'promoter', amount_cents: 200 },
      { id: '3', promoter_id: 'promoter', amount_cents: -100 },
      { id: '4', promoter_id: 'promoter', amount_cents: 400 },
      { id: '5', promoter_id: 'promoter', amount_cents: 500 },
    ],
  }).call();
  assert.equal(result.status, 200);
  assert.equal(result.body.promoter.earnedCents, 1100);
});

for (const failure of ['event_promoters', 'promoter_ledger_entries', 'promoter_attributions', 'second-ledger-page']) {
  test('does not return fabricated zeros or partial totals when ' + failure + ' fails', async () => {
    const result = await harness({ failure, ledger: [{ id: '1', promoter_id: 'promoter', amount_cents: 100 }] }).call();
    assert.equal(result.status, 500);
    assert.equal(result.body.promoter, undefined);
    assert.match(result.body.error, /^Could not load promoter/);
  });
}

test('an unavailable exact count is an error, not zero', async () => {
  const result = await harness({ missingCount: true }).call();
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'Could not load promoter attributed orders');
});

test('no promoter record does not query financial tables', async () => {
  const h = harness({ promoter: null });
  assert.deepEqual(await h.call(), { status: 200, body: { ok: true, isPromoter: false } });
  assert.deepEqual(h.queries.map(q => q.table), ['event_promoters']);
});

test('unauthenticated requests do not query financial tables', async () => {
  const h = harness({ userId: null });
  assert.equal((await h.call()).status, 401);
  assert.equal(h.queries.length, 0);
});

test('an unrelated event cannot expose the promoter summary', async () => {
  const h = harness();
  assert.deepEqual(await h.call({ action: 'me', event_id: 43 }), { status: 200, body: { ok: true, isPromoter: false } });
  assert.deepEqual(h.queries.map(q => q.table), ['event_promoters']);
});

test('exact attribution count is not truncated to the server row cap', async () => {
  const result = await harness({
    cap: 2,
    attributions: Array.from({ length: 2001 }, (_, i) => ({ order_id: 'order-' + i, promoter_id: 'promoter' })),
  }).call();
  assert.equal(result.status, 200);
  assert.equal(result.body.promoter.attributedOrders, 2001);
});

for (const promoter of [
  { id: 'promoter', event_id: 42, user_id: 'other-member', status: 'active' },
  { id: 'promoter', event_id: 42, user_id: 'member', status: 'removed' },
]) {
  test('only the current member active promoter record is visible: ' + promoter.user_id + '/' + promoter.status, async () => {
    const h = harness({ promoter });
    assert.deepEqual(await h.call(), { status: 200, body: { ok: true, isPromoter: false } });
    assert.deepEqual(h.queries.map(q => q.table), ['event_promoters']);
  });
}
