// Invoke the signed production webhook, real money-state helper and real ticket
// bundle loader/delivery helper. Only database/network boundaries are simulated.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { harness } = require('../_shared/payment-safety.test.cjs');

function fixture(options = {}) {
  const order = { id: 'order', event_id: 1, status: options.status || 'payment_pending',
    guest_email: options.member ? null : 'buyer@example.test', quantity: 2,
    total_cents: 1000, currency: 'usd', ticket_email_status: options.emailStatus || null,
    stripe_payment_intent_id: 'pi_fixture' };
  const tickets = Array.from({ length: options.existing || 0 }, (_, i) => ({
    id: `ticket_${i}`, order_id: 'order', event_id: 1, ticket_type_id: 'tier',
    stripe_payment_intent_id: 'pi_fixture', status: 'active', qr_token: `qr_${i}`,
    guest_lookup_token: `lookup_${i}`, guest_email: order.guest_email,
  }));
  const state = { moneyError: !!options.moneyError, countError: !!options.countError,
    orderError: !!options.orderError, missingOrder: !!options.missingOrder,
    holdError: !!options.holdError, emailError: !!options.emailError, markerError: !!options.markerError };
  const ops = [], sent = [], events = new Map();
  const db = {
    from(table) {
      const op = { table, kind: 'select', payload: null, filters: {} };
      let count = false;
      const run = () => {
        ops.push({ ...op });
        if (table === 'stripe_events') {
          if (op.kind === 'insert') {
            if (events.has(op.payload.event_id)) return { data: null, error: { code: '23505' } };
            events.set(op.payload.event_id, { ...op.payload, processed_at: null });
          }
          if (op.kind === 'update') {
            if (state.markerError) return { data: null, error: { message: 'marker unavailable' } };
            Object.assign(events.get(op.filters.event_id), op.payload);
          }
          return { data: events.get(op.filters.event_id) || null, error: null };
        }
        if (table === 'orders') {
          if (state.orderError) return { data: null, error: { message: 'order unavailable' } };
          if (state.missingOrder) return { data: null, error: null };
          if (op.kind === 'update') Object.assign(order, op.payload);
          return { data: order, error: null };
        }
        if (table === 'tickets') {
          if (count && state.countError) return { data: null, count: null, error: { message: 'count unavailable' } };
          if (op.kind === 'insert') tickets.push(...op.payload);
          const rows = tickets.filter(t => Object.entries(op.filters).every(([key, value]) => t[key] === value));
          return { data: count ? null : rows, count: rows.length, error: null };
        }
        if (table === 'ticket_holds' && state.holdError) return { data: null, error: { message: 'hold unavailable' } };
        if (table === 'ticket_types') return { data: { quantity_sold: 0 }, error: null };
        if (table === 'events') return { data: { title: 'Fixture event' }, error: null };
        return { data: [], error: null };
      };
      const q = { select: (_columns, opts) => { count = !!opts?.count; return q; },
        eq: (key, value) => { op.filters[key] = value; return q; }, order: () => q,
        insert: payload => { op.kind = 'insert'; op.payload = payload; return q; },
        update: payload => { op.kind = 'update'; op.payload = payload; return q; },
        single: async () => run(), maybeSingle: async () => run(),
        then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
      };
      return q;
    },
    async rpc(name, args) {
      ops.push({ rpc: name, args });
      if (name === 'upsert_order_money_state') {
        if (state.moneyError) return { data: null, error: { message: 'money unavailable' } };
        if (order.status === 'refunded') return { data: false, error: null };
        order.status = args.p_status;
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
  };
  const h = harness({ database: db, dependencyOverrides: {
    'order-state.ts': undefined,
    'send-resend-email.ts': { ticketConfirmation: data => ({ fixture: data }),
      sendResendEmail: async mail => {
        if (state.emailError) throw new Error('provider unavailable');
        assert.equal(order.status, 'paid');
        sent.push(mail); return 'email_fixture';
      } },
    'stripe-processing-fee.ts': { syncOrderStripeProcessingFeeSafely: async () => {} },
  } });
  async function run(eventId = 'evt_fixture') {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: eventId, type: 'payment_intent.succeeded', created: timestamp,
      data: { object: { id: 'pi_fixture', amount: 1000, metadata: {
        type: 'event_ticket', event_id: '1', ticket_type_id: 'tier', quantity: '2',
        ...(options.hostedGuest ? { guest_email: order.guest_email, quantity: undefined } : options.member ? { user_id: 'member' } : { is_door_sale: 'true', guest_email: order.guest_email }),
      } } } });
    const signature = createHmac('sha256', 'test').update(`${timestamp}.${body}`).digest('hex');
    return h.invoke('stripe-webhook', body, { 'stripe-signature': `t=${timestamp},v1=${signature}` });
  }
  return { run, state, order, tickets, ops, sent, events };
}

for (const existing of [0, 2]) test(`paid door fulfillment persists paid state before delivery (${existing} existing tickets)`, async () => {
  const f = fixture({ existing });
  const response = await f.run();
  assert.equal(response.status, 200, await response.text());
  assert.equal(f.order.status, 'paid');
  assert.equal(f.tickets.length, 2);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].fixture.tickets.length, 2);
  assert.equal(f.order.ticket_email_status, 'sent');
});

test('native member replay repairs pending order without reinserting tickets', async () => {
  const f = fixture({ member: true, existing: 2 });
  assert.equal((await f.run()).status, 200);
  assert.equal(f.order.status, 'paid');
  assert.equal(f.tickets.length, 2);
  assert.equal(f.sent.length, 0);
});

for (const existing of [0, 2]) test(`actual money RPC error keeps event retryable (${existing} existing tickets)`, async () => {
  const f = fixture({ existing, moneyError: true });
  assert.equal((await f.run()).status, 500);
  assert.equal(f.order.status, 'payment_pending');
  assert.equal(f.sent.length, 0);
  assert.equal(f.events.get('evt_fixture').processed_at, null);
  f.state.moneyError = false;
  assert.equal((await f.run()).status, 200);
  assert.equal(f.order.status, 'paid');
  assert.equal(f.tickets.length, 2);
  assert.equal(f.sent.length, 1);
});

for (const key of ['orderError', 'missingOrder', 'countError']) test(`${key} cannot mint orphan or duplicate tickets`, async () => {
  const f = fixture({ [key]: true });
  assert.equal((await f.run()).status, 500);
  assert.equal(f.tickets.length, 0);
  assert.equal(f.events.get('evt_fixture').processed_at, null);
});

test('completed and distinct-event replays do not resend or reissue', async () => {
  const f = fixture();
  assert.equal((await f.run()).status, 200);
  assert.equal((await f.run()).status, 200);
  assert.equal((await f.run('evt_distinct')).status, 200);
  assert.equal(f.sent.length, 1);
  assert.equal(f.tickets.length, 2);
});

test('newer refund state is preserved and ticket email is not sent', async () => {
  const f = fixture({ existing: 2, status: 'refunded' });
  assert.equal((await f.run()).status, 200);
  assert.equal(f.order.status, 'refunded');
  assert.equal(f.sent.length, 0);
});

test('email failure preserves paid tickets and a later delivery attempt sends the bundle', async () => {
  const f = fixture({ emailError: true });
  assert.equal((await f.run()).status, 200);
  assert.equal(f.order.status, 'paid');
  assert.equal(f.order.ticket_email_status, 'failed');
  assert.equal(f.tickets.length, 2);
  f.state.emailError = false;
  assert.equal((await f.run('evt_retry_delivery')).status, 200);
  assert.equal(f.sent.length, 1);
  assert.equal(f.tickets.length, 2);
});

test('failed event completion marker returns retryable failure', async () => {
  const f = fixture({ markerError: true });
  assert.equal((await f.run()).status, 500);
  assert.equal(f.events.get('evt_fixture').processed_at, null);
  f.state.markerError = false;
  assert.equal((await f.run()).status, 200);
  assert.equal(f.sent.length, 1);
  assert.equal(f.tickets.length, 2);
});

for (const existing of [1, 3]) test(`incomplete or excessive issuance (${existing}/2) cannot become a successful order`, async () => {
  const f = fixture({ existing });
  assert.equal((await f.run()).status, 500);
  assert.equal(f.order.status, 'payment_pending');
  assert.equal(f.tickets.length, existing);
  assert.equal(f.sent.length, 0);
});

for (const existing of [0, 2]) test(`hosted guest PaymentIntent never enters native issuance (${existing} existing tickets)`, async () => {
  const f = fixture({ hostedGuest: true, existing });
  assert.equal((await f.run()).status, 200);
  assert.equal(f.tickets.length, existing);
  assert.equal(f.order.status, 'payment_pending');
  assert.equal(f.sent.length, 0);
  assert.equal(f.ops.some(op => op.rpc === 'upsert_order_money_state'), false);
});

for (const existing of [0, 2]) test(`hold conversion error is retried without ticket reinsertion (${existing} existing tickets)`, async () => {
  const f = fixture({ existing, holdError: true });
  assert.equal((await f.run()).status, 500);
  assert.equal(f.events.get('evt_fixture').processed_at, null);
  assert.equal(f.order.status, 'payment_pending');
  assert.equal(f.tickets.length, 2);
  f.state.holdError = false;
  assert.equal((await f.run()).status, 200);
  assert.equal(f.ops.filter(op => op.table === 'ticket_holds' && op.kind === 'update').length, 2);
  assert.equal(f.tickets.length, 2);
  assert.equal(f.order.status, 'paid');
  assert.equal(f.sent.length, 1);
});
