const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness } = require('./payment-safety.test.cjs');

function fixture({ issued = 1, status = 'payment_pending', moneyFailure = false, ticketFailure = false, orderFailure = false, holdFailure = false, quantity = 1, amount = 1000, member = false, expandedPi = false } = {}) {
  const order = { id: 'order', status, ticket_email_status: null };
  const events = [], deliveries = [], writes = [], allocations = [];
  const db = {
    from(table) {
      const q = {
        select: () => q, eq: () => q, update: payload => { writes.push({ table, payload }); return q; }, insert: () => q, upsert: () => q,
        maybeSingle: async () => ({ data: orderFailure ? null : order, error: orderFailure ? { message: 'order read failed' } : null }),
        then(resolve, reject) {
          return Promise.resolve({ data: table === 'tickets' ? Array.from({ length: issued }, () => ({ id: 'ticket' })) : [], error: table === 'tickets' && ticketFailure ? { message: 'ticket insert failed' } : table === 'ticket_holds' && holdFailure ? { message: 'hold conversion failed' } : null }).then(resolve, reject);
        },
      };
      return q;
    },
    rpc: async (name, args) => {
      if (name === 'paid_ticket_issuance_atomic') {
        allocations.push(args);
        if (ticketFailure || holdFailure) return { data: null, error: { message: ticketFailure ? 'ticket insert failed' : 'hold conversion failed' } };
        if (order.status === 'refunded') return { data: { ok: true, terminal: true, duplicate: true, order_id: 'order', issued_count: 0, tickets: [] }, error: null };
        return { data: { ok: true, duplicate: issued === 0, order_id: 'order', issued_count: issued ? quantity : 0, tickets: args.p_ticket_rows }, error: null };
      }
      if (name !== 'upsert_order_money_state') return { data: null, error: null };
      events.push('money');
      if (moneyFailure) return { data: null, error: { message: 'money write failed' } };
      if (order.status === 'refunded') return { data: false, error: null };
      order.status = 'paid';
      return { data: true, error: null };
    },
  };
  const h = harness({ database: db, dependencyOverrides: {
    'order-state.ts': undefined, // Exercise the real RPC helper, not a throwing stub.
    'checkout-profile.ts': { finalizeCheckoutProfile: async () => ({ status: 'none' }) },
    'ticket-email-delivery.ts': { deliverTicketBundleEmail: async (_db, _id, opts) => {
      events.push('email');
      // Same admission rule as the actual delivery module.
      if (order.status !== 'paid') return { ok: false, reason: 'order_not_paid' };
      if (order.ticket_email_status !== 'sent') deliveries.push(opts.kind);
      order.ticket_email_status = 'sent';
      return { ok: true };
    } },
    'send-resend-email.ts': {},
  } });
  const { issueTicketsForCheckoutSession } = h.load(path.join(__dirname, 'session-issuance.ts'));
  const run = () => issueTicketsForCheckoutSession(db, {
    id: 'cs_test_fixture', amount_total: amount, payment_intent: expandedPi ? { id: 'pi_fixture' } : 'pi_fixture',
    metadata: { event_id: '1', ticket_type_id: 'tier', ...(member ? { user_id: 'member' } : { guest_email: 'fixture@example.com' }), quantity: String(quantity) },
  }, { eventCreatedAt: '2026-10-15T00:00:00Z', logPrefix: '[test]' });
  return { run, order, events, deliveries, writes, allocations };
}

for (const issued of [1, 0]) test(`paid state precedes guest email when ${issued} new tickets are issued`, async () => {
  const f = fixture({ issued });
  await f.run();
  assert.deepEqual(f.events, ['money', 'email']);
  assert.equal(f.order.ticket_email_status, 'sent');
  assert.deepEqual(f.deliveries, [issued ? 'fulfillment' : 'retry']);
});

test('replayed fulfillment does not send another email', async () => {
  const f = fixture({ issued: 0 });
  await f.run(); await f.run();
  assert.equal(f.deliveries.length, 1);
});

test('failed money-state persistence never reaches email delivery', async () => {
  const f = fixture({ moneyFailure: true });
  await assert.rejects(f.run(), error => error.message === 'money write failed');
  assert.deepEqual(f.events, ['money']);
  assert.equal(f.deliveries.length, 0);
});

test('a newer refund remains ineligible for ticket delivery', async () => {
  const f = fixture({ issued: 0, status: 'refunded' });
  await f.run();
  assert.equal(f.order.status, 'refunded');
  assert.equal(f.deliveries.length, 0);
});

for (const [key, message] of [['ticketFailure', 'ticket insert failed'], ['orderFailure', 'order read failed']]) {
  test(`${key} leaves the capacity hold untouched`, async () => {
    const f = fixture({ [key]: true });
    await assert.rejects(f.run(), error => error.message === message);
    assert.equal(f.writes.some(write => write.table === 'ticket_holds'), false);
    assert.equal(f.deliveries.length, 0);
  });
}

test('hold conversion error stays retryable and never reaches delivery', async () => {
  const f = fixture({ holdFailure: true });
  await assert.rejects(f.run(), error => error.message === 'hold conversion failed');
  assert.equal(f.deliveries.length, 0);
});

for (const member of [false, true]) test(`hosted ${member ? 'member' : 'guest'} allocation preserves cents and uses one atomic boundary`, async () => {
  const f = fixture({ quantity: 3, amount: 1001, member, expandedPi: true });
  assert.equal((await f.run()).issued, 3);
  assert.equal(f.allocations.length, 1);
  const args = f.allocations[0];
  assert.equal(args.p_payment_intent_id, 'pi_fixture');
  assert.equal(args.p_checkout_session_id, 'cs_test_fixture');
  assert.equal(args.p_amount_cents, 1001);
  assert.deepEqual(Array.from(args.p_ticket_rows, row => row.purchase_amount_cents), [334, 334, 333]);
  assert.equal(args.p_ticket_rows.every(row => row.user_id === (member ? 'member' : null)), true);
  assert.equal(f.writes.some(write => ['tickets', 'ticket_types', 'ticket_holds'].includes(write.table)), false);
});

test('terminal paid replay does not change money-state or attempt email delivery', async () => {
  const f = fixture({ issued: 0, status: 'refunded' });
  assert.equal((await f.run()).terminal, true);
  assert.deepEqual(f.events, []);
});
