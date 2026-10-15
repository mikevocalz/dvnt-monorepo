const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness } = require('./payment-safety.test.cjs');

function fixture({ issued = 1, status = 'payment_pending', moneyFailure = false } = {}) {
  const order = { id: 'order', status, ticket_email_status: null };
  const events = [], deliveries = [];
  const db = {
    from(table) {
      const q = {
        select: () => q, eq: () => q, update: () => q, insert: () => q, upsert: () => q,
        maybeSingle: async () => ({ data: order, error: null }),
        then(resolve, reject) {
          return Promise.resolve({ data: table === 'tickets' ? Array.from({ length: issued }, () => ({ id: 'ticket' })) : [], error: null }).then(resolve, reject);
        },
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  const h = harness({ database: db, dependencyOverrides: {
    'order-state.ts': {
      upsertOrderMoneyState: async () => {
        events.push('money');
        if (moneyFailure) throw new Error('money write failed');
        if (order.status !== 'refunded') order.status = 'paid';
      },
      recordPromoterEarning: async () => {},
    },
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
    id: 'cs_test_fixture', amount_total: 1000, payment_intent: null,
    metadata: { event_id: '1', ticket_type_id: 'tier', guest_email: 'fixture@example.com', quantity: '1' },
  }, { eventCreatedAt: '2026-10-15T00:00:00Z', logPrefix: '[test]' });
  return { run, order, events, deliveries };
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
  await assert.rejects(f.run(), /money write failed/);
  assert.deepEqual(f.events, ['money']);
  assert.equal(f.deliveries.length, 0);
});

test('a newer refund remains ineligible for ticket delivery', async () => {
  const f = fixture({ issued: 0, status: 'refunded' });
  await f.run();
  assert.equal(f.order.status, 'refunded');
  assert.equal(f.deliveries.length, 0);
});
