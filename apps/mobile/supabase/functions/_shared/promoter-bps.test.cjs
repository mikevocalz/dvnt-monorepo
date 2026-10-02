// manage-promoters basis-point limits: customer discount and promoter
// commission are capped at 100% (10000 bps) on BOTH add and update, and
// the cap is enforced server-side before any row is written. A rejected
// value must never reach an insert/update.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./payment-safety.test.cjs');

function fixture({ hostId = 'staff' } = {}) {
  const writes = [];
  const rows = {
    session: [{ token: 'fixture-token', userId: 'staff',
      expiresAt: new Date(Date.now() + 60000).toISOString() }],
    events: [{ id: 1, host_id: hostId, title: 'Fixture' }],
    event_co_organizers: [],
    event_promoters: [{
      id: 'p1', event_id: 1, user_id: null, display_name: 'Andre',
      code: 'ANDRE', rev_share_bps: 1000, customer_discount_bps: 1000,
      promoter_commission_bps: 1000, status: 'active', created_at: 'x',
    }],
    users: [],
    notifications: [],
    push_tokens: [],
    promoter_attributions: [],
    promoter_ledger_entries: [],
    orders: [],
  };
  return { writes, database: { from(table) {
    assert.ok(table in rows, `Unexpected table: ${table}`);
    let selected = rows[table];
    let operation, payload;
    const result = async () => {
      if (operation) writes.push({ table, operation, payload });
      return { data: selected, error: null };
    };
    const one = async () => {
      if (operation) writes.push({ table, operation, payload });
      return { data: selected[0] || null, error: null };
    };
    const q = { select: () => q, order: () => q, limit: () => q,
      eq: (k, v) => { selected = selected.filter(r => r[k] === v); return q; },
      in: (k, vs) => { selected = selected.filter(r => vs.includes(r[k])); return q; },
      neq: () => q, gt: () => q, is: () => q, not: () => q,
      insert: p => { payload = p; operation = 'insert'; return q; },
      update: p => { payload = p; operation = 'update'; return q; },
      single: one, maybeSingle: one,
      then: (res, rej) => result().then(res, rej) };
    return q;
  }, rpc() { assert.fail('no RPC expected'); } } };
}

function invoke(body) {
  const f = fixture();
  const h = harness({ database: f.database,
    dependencyOverrides: { 'verify-session.ts': undefined } });
  return h.invoke('manage-promoters', body,
    { 'x-auth-token': 'fixture-token' }).then(async r => ({
      status: r.status, body: await r.json(), writes: f.writes }));
}

for (const c of [
  { name: 'add discount 101% rejected', body: { action: 'add', event_id: 1,
    display_name: 'X', customer_discount_bps: 10001, promoter_commission_bps: 1000 } },
  { name: 'add commission 101% rejected', body: { action: 'add', event_id: 1,
    display_name: 'X', customer_discount_bps: 1000, promoter_commission_bps: 10001 } },
  { name: 'add commission via rev_share 101% rejected', body: { action: 'add',
    event_id: 1, display_name: 'X', customer_discount_bps: 1000, rev_share_bps: 15000 } },
  { name: 'add negative discount rejected', body: { action: 'add', event_id: 1,
    display_name: 'X', customer_discount_bps: -1, promoter_commission_bps: 1000 } },
  { name: 'add fractional discount rejected', body: { action: 'add', event_id: 1,
    display_name: 'X', customer_discount_bps: 100.5, promoter_commission_bps: 1000 } },
  { name: 'add string discount rejected', body: { action: 'add', event_id: 1,
    display_name: 'X', customer_discount_bps: 'abc', promoter_commission_bps: 1000 } },
  { name: 'update discount 101% rejected', body: { action: 'update',
    promoter_id: 'p1', customer_discount_bps: 10001 } },
  { name: 'update commission 101% rejected', body: { action: 'update',
    promoter_id: 'p1', promoter_commission_bps: 10001 } },
  { name: 'update legacy rev_share 101% rejected', body: { action: 'update',
    promoter_id: 'p1', rev_share_bps: 10001 } },
  { name: 'update negative commission rejected', body: { action: 'update',
    promoter_id: 'p1', promoter_commission_bps: -5 } },
  { name: 'update fractional discount rejected', body: { action: 'update',
    promoter_id: 'p1', customer_discount_bps: 3333.3 } },
]) {
  test(c.name, async () => {
    const { status, writes } = await invoke(c.body);
    assert.equal(status, 400);
    assert.equal(writes.length, 0, 'rejected value must not be written');
  });
}

test('add at exactly 100% is allowed', async () => {
  const { status, body, writes } = await invoke({ action: 'add', event_id: 1,
    display_name: 'Full', customer_discount_bps: 10000,
    promoter_commission_bps: 10000 });
  assert.equal(status, 200, JSON.stringify(body));
  const ins = writes.find(w => w.table === 'event_promoters' && w.operation === 'insert');
  assert.ok(ins);
  assert.equal(ins.payload.customer_discount_bps, 10000);
  assert.equal(ins.payload.promoter_commission_bps, 10000);
});

test('update at exactly 100% persists both fields', async () => {
  const { status, body, writes } = await invoke({ action: 'update',
    promoter_id: 'p1', customer_discount_bps: 10000,
    promoter_commission_bps: 10000 });
  assert.equal(status, 200, JSON.stringify(body));
  const upd = writes.find(w => w.table === 'event_promoters' && w.operation === 'update');
  assert.ok(upd);
  assert.equal(upd.payload.customer_discount_bps, 10000);
  assert.equal(upd.payload.promoter_commission_bps, 10000);
  assert.equal(upd.payload.rev_share_bps, 10000);
});

test('non-owner cannot reach validation or writes', async () => {
  const f = fixture({ hostId: 'someone-else' });
  const h = harness({ database: f.database,
    dependencyOverrides: { 'verify-session.ts': undefined } });
  const r = await h.invoke('manage-promoters', { action: 'add', event_id: 1,
    display_name: 'X', customer_discount_bps: 1000,
    promoter_commission_bps: 1000 }, { 'x-auth-token': 'fixture-token' });
  assert.equal(r.status, 403);
  assert.equal(f.writes.length, 0);
});
