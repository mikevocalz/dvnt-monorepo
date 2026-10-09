// charge.refunded ticket scoping. organizer-refund refunds the whole
// PaymentIntent and names one ticket in the refund metadata; ticket-refund
// and bulk-refund-tickets refund one ticket's amount and name that ticket.
// The metadata scopes the status flip only for a partial refund. When the
// charge is fully refunded every active ticket on it is refunded.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { harness } = require('../_shared/payment-safety.test.cjs');

// Recording service-role client: every query keeps its table, operation,
// payload and filters so the test can see which rows an update targeted.
function recordingDb(tables) {
  const ops = [], rpcs = [];
  const client = {
    ops, rpcs,
    from(table) {
      const op = { table, operation: 'select', payload: null, eq: {}, in: {} };
      const rows = () => (tables[table] || []).filter(row =>
        Object.entries(op.eq).every(([k, v]) => row[k] === undefined || row[k] === v)
        && Object.entries(op.in).every(([k, v]) => row[k] === undefined || v.includes(row[k])));
      const q = {
        select: () => q,
        insert: p => { op.operation = 'insert'; op.payload = p; return q; },
        update: p => { op.operation = 'update'; op.payload = p; return q; },
        upsert: p => { op.operation = 'upsert'; op.payload = p; return q; },
        eq: (k, v) => { op.eq[k] = v; return q; },
        in: (k, v) => { op.in[k] = v; return q; },
        is: () => q, not: () => q, gte: () => q, lt: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => { ops.push(op); return { data: rows()[0] ?? null, error: null }; },
        single: async () => { ops.push(op); return { data: rows()[0] ?? null, error: null }; },
        then: (resolve, reject) => {
          ops.push(op);
          const data = op.operation === 'select' ? rows() : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, args) { rpcs.push({ name, args }); return { data: { ok: true }, error: null }; },
  };
  return client;
}

const GROUP = [
  { id: 't1', event_id: 1, ticket_type_id: 'tier', status: 'active', stripe_payment_intent_id: 'pi_group' },
  { id: 't2', event_id: 1, ticket_type_id: 'tier', status: 'active', stripe_payment_intent_id: 'pi_group' },
  { id: 't3', event_id: 1, ticket_type_id: 'tier', status: 'active', stripe_payment_intent_id: 'pi_group' },
];

async function refund({ amount, amountRefunded, metadata }) {
  const db = recordingDb({ tickets: GROUP, ticket_types: [{ id: 'tier', quantity_sold: 3, name: 'GA', event_id: 1 }] });
  const voided = [];
  const h = harness({
    database: db,
    dependencyOverrides: {
      'order-state.ts': { upsertOrderMoneyState: async () => {}, recordPromoterReversal: async () => {},
        recordPromoterEarning: async () => {} },
      'wallet-push.ts': { voidWalletPass: async (_db, id) => { voided.push(id); } },
      'notify-waitlisters.ts': { notifyNextWaitlister: async () => {} },
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: 'evt_' + amountRefunded, type: 'charge.refunded', created: timestamp,
    data: { object: { payment_intent: 'pi_group', amount, amount_refunded: amountRefunded,
      refunds: { data: [{ id: 're_1', amount: amountRefunded, metadata }] } } } });
  const signature = createHmac('sha256', 'test').update(`${timestamp}.${body}`).digest('hex');
  const r = await h.invoke('stripe-webhook', body, { 'stripe-signature': `t=${timestamp},v1=${signature}` });
  assert.equal(r.status, 200, await r.clone().text());
  const flip = db.ops.find(o => o.table === 'tickets' && o.operation === 'update'
    && o.payload?.status === 'refunded');
  const tierWrite = db.ops.find(o => o.table === 'ticket_types' && o.operation === 'update');
  return { flip, tierWrite, voided, db };
}

test('organizer full refund naming one ticket refunds every active ticket on the charge', async () => {
  const { flip, tierWrite } = await refund({ amount: 7500, amountRefunded: 7500,
    metadata: { triggered_by: 'organizer', ticket_id: 't1' } });
  assert.ok(flip, 'tickets were never flipped to refunded');
  assert.equal(flip.eq.stripe_payment_intent_id, 'pi_group');
  assert.equal(flip.in.id, undefined, 'a full refund must not be scoped to the named ticket');
  assert.equal(tierWrite.payload.quantity_sold, 0, 'all three seats go back to the tier');
});

test('a partial refund naming one ticket still flips only that ticket', async () => {
  const { flip, tierWrite } = await refund({ amount: 7500, amountRefunded: 2500,
    metadata: { ticket_id: 't1' } });
  assert.deepEqual([...flip.in.id], ['t1']);
  assert.equal(tierWrite.payload.quantity_sold, 2);
});

test('a full refund voids the wallet pass of every refunded ticket on the charge', async () => {
  const { db } = await refund({ amount: 7500, amountRefunded: 7500,
    metadata: { triggered_by: 'organizer', ticket_id: 't1' } });
  const walletRead = db.ops.find(o => o.table === 'tickets' && o.operation === 'select'
    && o.eq.status === 'refunded');
  assert.ok(walletRead, 'no wallet void lookup');
  assert.equal(walletRead.in.id, undefined, 'wallet void must cover the whole charge on a full refund');
});
