// Actual door handler + session verifier; in-memory query fixture, no network.
// This supplements, and does not replace, deployed authenticated probes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./payment-safety.test.cjs');

function fixture({ user = 'member', role, accepted = true, membershipEvent = 1,
  membershipUser = user, expired = false, revoked = false, sessionError = false } = {}) {
  const reads = [];
  const rows = {
    session: [{ token: 'fixture-token', userId: user,
      expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)).toISOString() }],
    events: [{ id: 1, host_id: 'owner', title: 'Isolated fixture', fee_mode: 'pass' }],
    event_co_organizers: role && !revoked ? [{ event_id: membershipEvent,
      user_id: membershipUser, role, accepted }] : [],
    ticket_types: [{ id: 'tier', event_id: 1, name: 'Admission', price_cents: 5000,
      currency: 'usd', quantity_total: 10, quantity_sold: 0, max_per_user: 20 }],
    // Read by the per-guest cap and the server-side remaining count.
    tickets: [],
    ticket_holds: [],
    cart_holds: [],
    // terminal-token reads the platform Location mapping.
    event_terminal_locations: [],
  };
  return { reads, database: { from(table) {
    reads.push(table);
    assert.ok(table in rows, `Unexpected table: ${table}`);
    let selected = rows[table];
    const result = async () => ({ data: selected[0] || null,
      error: table === 'session' && sessionError ? { message: 'fixture failure', code: 'TEST' } : null });
    const q = { select: () => q, order: () => q, limit: () => q,
      eq: (key, value) => { selected = selected.filter(row => row[key] === value); return q; },
      in: (key, values) => { selected = selected.filter(row => values.includes(row[key])); return q; },
      gt: () => q, neq: () => q,
      single: result, maybeSingle: result,
      then: (resolve, reject) => result().then(resolve, reject) };
    return q;
  }, rpc() { assert.fail('Permission probes must not call a write RPC'); } } };
}

const cases = [
  { name: 'owner', user: 'owner', status: 200 },
  ...['scanner', 'editor', 'admin'].map(role => ({ name: role, role, status: 200 })),
  ...['promoter', 'viewer', 'outsider'].map(role => ({ name: role, role, status: 403 })),
  { name: 'pending scanner', role: 'scanner', accepted: false, status: 403 },
  { name: 'revoked scanner', role: 'scanner', revoked: true, status: 403 },
  { name: 'staff on another event', role: 'admin', membershipEvent: 2, status: 403 },
  { name: 'another user owns membership', role: 'admin', membershipUser: 'other', status: 403 },
  { name: 'expired owner session', user: 'owner', expired: true, status: 401 },
  { name: 'invalid token', token: 'invalid', status: 401 },
  { name: 'missing token', token: '', status: 401 },
  { name: 'session database error fails closed', user: 'owner', sessionError: true, status: 401 },
];

for (const scenario of cases) {
  // Allowed roles use the read-only quote; rejected roles also probe sale entry.
  for (const action of scenario.status === 200 ? ['quote'] : ['quote', 'sell']) {
    test(`${scenario.name}: ${action} returns ${scenario.status} without side effects`, async () => {
      const f = fixture(scenario);
      const h = harness({ database: f.database,
        dependencyOverrides: { 'verify-session.ts': undefined } });
      const response = await h.invoke('door-sell', { action, event_id: 1,
        ticket_type_id: 'tier', quantity: 1, guest_email: 'fixture@example.invalid',
        // Client attempts to impersonate the owner must have no effect.
        sold_by_staff_user_id: 'owner', user_id: 'owner', role: 'admin' },
      { 'x-auth-token': scenario.token ?? 'fixture-token' });
      assert.equal(response.status, scenario.status, await response.text());
      assert.equal(h.requests.length, 0, 'No Stripe/network request');
      assert.equal(h.writes.length, 0);
      if (scenario.status !== 200) assert.ok(!f.reads.includes('ticket_types'));
      if (scenario.status === 401) assert.ok(!f.reads.includes('events'));
    });
  }
}

// terminal-token: same event-scoped predicate, minted per call, and the
// denied cases must never reach Stripe. Authorized staff without a
// configured Terminal Location get 409, not a token.
for (const scenario of [
  { name: 'terminal-token owner without location', user: 'owner', status: 409 },
  { name: 'terminal-token outsider', role: 'outsider', status: 403 },
  { name: 'terminal-token missing token', token: '', status: 401 },
]) {
  test(`${scenario.name} returns ${scenario.status} without side effects`, async () => {
    const f = fixture(scenario);
    f.database = { from: f.database.from, rpc: f.database.rpc };
    const h = harness({ database: f.database,
      dependencyOverrides: { 'verify-session.ts': undefined } });
    const response = await h.invoke('terminal-token', { event_id: 1 },
      { 'x-auth-token': scenario.token ?? 'fixture-token' });
    assert.equal(response.status, scenario.status, await response.text());
    assert.equal(h.requests.length, 0, 'No Stripe request before authz/location');
    assert.equal(h.writes.length, 0);
  });
}
