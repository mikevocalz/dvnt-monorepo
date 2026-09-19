// Actual door handler + session verifier; in-memory query fixture, no network.
// This supplements, and does not replace, deployed authenticated probes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./payment-safety.test.cjs');

function fixture({ user = 'member', role, accepted = true, membershipEvent = 1,
  membershipUser = user, expired = false, revoked = false, sessionError = false,
  order } = {}) {
  const reads = [];
  const writes = [];
  const rows = {
    session: [{ token: 'fixture-token', userId: user,
      expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)).toISOString() }],
    events: [{ id: 1, host_id: 'owner', title: 'Isolated fixture', fee_mode: 'pass' }],
    event_co_organizers: role && !revoked ? [{ event_id: membershipEvent,
      user_id: membershipUser, role, accepted }] : [],
    ticket_types: [{ id: 'tier', event_id: 1, name: 'Admission', price_cents: 5000,
      currency: 'usd', quantity_total: 10, quantity_sold: 0, max_per_user: 20 }],
    // Read by the per-guest cap, the server-side remaining count, and the
    // resend bundle loader (order-linked tickets only).
    tickets: order?.tickets ?? [],
    ticket_holds: [],
    cart_holds: [],
    orders: order ? [order] : [],
    order_timeline: [],
    // terminal-token reads the platform Location mapping.
    event_terminal_locations: [],
  };
  return { reads, writes, database: { from(table) {
    reads.push(table);
    assert.ok(table in rows, `Unexpected table: ${table}`);
    let selected = rows[table];
    let operation, payload;
    // List queries (awaited directly) get the filtered array; .single()/
    // .maybeSingle() get the first row or null.
    const error = table === 'session' && sessionError
      ? { message: 'fixture failure', code: 'TEST' } : null;
    const result = async () => {
      if (operation) writes.push({ table, operation, payload });
      return { data: selected, error };
    };
    const one = async () => {
      if (operation) writes.push({ table, operation, payload });
      return { data: selected[0] || null, error };
    };
    const q = { select: () => q, order: () => q, limit: () => q,
      eq: (key, value) => { selected = selected.filter(row => row[key] === value); return q; },
      in: (key, values) => { selected = selected.filter(row => values.includes(row[key])); return q; },
      gt: () => q, gte: () => q, lt: () => q, neq: () => q,
      is: () => q, not: () => q, ilike: () => q, or: () => q,
      insert: p => { payload = p; operation = 'insert'; return q; },
      update: p => { payload = p; operation = 'update'; return q; },
      single: one, maybeSingle: one,
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

// action:"resend" — re-emails the order's EXISTING bundle. Denied roles
// must never reach the order lookup; a successful resend must never write
// a ticket, mint an order, or call Stripe — only the orders state update,
// the timeline insert, and the Resend request.
const paidOrder = { id: 'o1', event_id: 1, status: 'paid', quantity: 2,
  guest_email: 'guest@fixture.co', total_cents: 9000, currency: 'usd',
  ticket_email_status: 'sent', ticket_email_attempts: 1,
  stripe_payment_intent_id: 'pi_fixture' };
const orderTickets = [
  { id: 't1', order_id: 'o1', event_id: 1, status: 'active', qr_token: 'qr1',
    guest_lookup_token: 'look1', guest_name: 'Guest', attendee_name: null,
    ticket_type: { name: 'GA', category: 'ga' } },
  { id: 't2', order_id: 'o1', event_id: 1, status: 'active', qr_token: 'qr2',
    guest_lookup_token: 'look2', guest_name: 'Guest', attendee_name: null,
    ticket_type: { name: 'GA', category: 'ga' } },
];

for (const scenario of [
  { name: 'resend owner re-emails bundle', user: 'owner',
    order: { ...paidOrder, tickets: orderTickets }, status: 200 },
  { name: 'resend unpaid order refused', user: 'owner',
    order: { ...paidOrder, status: 'payment_pending' }, status: 409 },
  { name: 'resend missing order', user: 'owner', status: 404 },
  { name: 'resend outsider', role: 'outsider',
    order: { ...paidOrder, tickets: orderTickets }, status: 403 },
  { name: 'resend missing token', token: '',
    order: { ...paidOrder, tickets: orderTickets }, status: 401 },
]) {
  test(`${scenario.name} → ${scenario.status}`, async () => {
    const f = fixture(scenario);
    const h = harness({ database: f.database,
      dependencyOverrides: { 'verify-session.ts': undefined } });
    const response = await h.invoke('door-sell', { action: 'resend',
      event_id: 1, order_id: 'o1' },
      { 'x-auth-token': scenario.token ?? 'fixture-token' });
    assert.equal(response.status, scenario.status, await response.text());
    // Never a ticket insert, never an RPC write, never a Stripe call.
    assert.ok(!f.writes.some(w => w.table === 'tickets'));
    assert.ok(!h.requests.some(r => String(r.url).includes('stripe.com')));
    if (scenario.status === 200) {
      // Exactly one outbound request: the Resend send. Plus state writes
      // on orders + order_timeline — no ticket/order/charge creation.
      assert.equal(h.requests.length, 1);
      assert.ok(String(h.requests[0].url).includes('resend.com'));
      assert.ok(f.writes.every(w =>
        (w.table === 'orders' && w.operation === 'update') ||
        (w.table === 'order_timeline' && w.operation === 'insert')));
      assert.ok(f.writes.some(w =>
        w.table === 'order_timeline' && w.payload.type === 'ticket_email_resent'));
    } else {
      assert.equal(h.requests.length, 0, 'No Resend request');
      assert.equal(f.writes.length, 0);
    }
  });
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
