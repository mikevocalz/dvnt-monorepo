// Offline database/network boundaries shared by signed-webhook and real cron-handler tests.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { harness } = require('../_shared/payment-safety.test.cjs');

function fixture({ rail = 'addon', status = 'payment_pending', cartStatus = 'holding', expired = false, recoveryCandidate = true, existingTickets = 0 } = {}) {
  const order = { id: 'order_fixture', cart_id: 'cart_fixture', event_id: 7, user_id: 'member_fixture',
    status, type: 'event_ticket', currency: 'usd', total_cents: 2250, stripe_payment_intent_id: 'pi_fixture',
    guest_email: null, stripe_fee_cents: 0, created_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    last_event_at: null, paid_at: null, refunded_at: status === 'refunded' ? new Date().toISOString() : null };
  const cart = { id: 'cart_fixture', event_id: 7, user_id: 'member_fixture', status: cartStatus,
    stripe_pi_id: 'pi_fixture', currency: 'usd', total_cents: 2250 };
  const lines = [];
  if (rail !== 'addon') lines.push({ id: 'admission_line', cart_id: cart.id, tier_id: 'tier_fixture',
    addon_id: null, category: 'admission', quantity: 2, ticket_types: { event_id: 7 } });
  if (rail !== 'admission') lines.push({ id: 'addon_line', cart_id: cart.id, tier_id: null,
    addon_id: 'addon_fixture', category: 'addon', quantity: 3,
    ticket_addons: { event_id: 7, is_redeemable: true } });
  const hold = { released: cartStatus === 'abandoned', expired, expires_at: new Date(Date.now() + 600000).toISOString() };
  const events = new Map(), tickets = Array.from({ length: existingTickets }, (_, i) => ({ id: `old_ticket_${i}`, stripe_payment_intent_id: 'pi_fixture' })), addons = [], timeline = [], ops = [];
  const state = { issuanceError: false, markerError: false, moneyError: false, inventoryAvailable: true, issuanceGate: null, stripeError: false, candidateError: false, orderUpdateError: false, orderReadGate: null };
  const captures = [];
  const currentPayment = { id: 'pi_fixture', status: 'succeeded', amount: 2250, amount_received: 2250, currency: 'usd',
    metadata: { type: 'cart_checkout', cart_id: cart.id, user_id: cart.user_id, event_id: '7' },
    latest_charge: { id: 'ch_fixture', payment_intent: 'pi_fixture', status: 'succeeded', paid: true, captured: true, refunded: false, amount_refunded: 0, disputed: false } };
  let allocationLock = Promise.resolve();
  function matches(row, filters) {
    return filters.every(([operator, key, value]) => operator === 'eq' ? row[key] === value
      : operator === 'in' ? value.includes(row[key]) : operator === 'not' ? row[key] != null : true);
  }
  const db = {
    from(table) {
      const op = { table, kind: 'select', payload: null, filters: [] };
      let asSingle = false, count = false;
      const execute = () => {
        ops.push({ ...op, filters: [...op.filters] });
        if (table === 'stripe_events') {
          if (op.kind === 'insert') {
            if (events.has(op.payload.event_id)) return { data: null, error: { code: '23505' } };
            events.set(op.payload.event_id, { ...op.payload, processed_at: null });
          }
          const rows = [...events.values()].filter(row => matches(row, op.filters));
          if (op.kind === 'update') {
            if (state.markerError) return { data: null, error: { message: 'completion marker unavailable' } };
            for (const row of rows) Object.assign(row, op.payload);
          }
          return { data: asSingle ? rows[0] || null : rows, error: null };
        }
        if (table === 'orders' && op.kind === 'update' && state.orderUpdateError) return { data: null, error: { message: 'order write unavailable' } };
        let rows = table === 'orders' ? [order] : table === 'carts' ? [cart]
          : table === 'cart_line_items' ? lines : table === 'tickets' ? tickets
          : table === 'order_addons' ? addons : table === 'order_timeline' ? timeline
          : table === 'ticket_types' ? [{ id: 'tier_fixture', quantity_sold: tickets.length }]
          : table === 'events' ? [{ id: 7, title: 'Fixture event' }] : [];
        rows = rows.filter(row => matches(row, op.filters));
        if (op.kind === 'update') for (const row of rows) Object.assign(row, op.payload);
        if (op.kind === 'insert' && table === 'order_timeline') timeline.push(...(Array.isArray(op.payload) ? op.payload : [op.payload]));
        return { data: count ? null : asSingle ? rows[0] || null : rows, count: rows.length, error: null };
      };
      const q = {
        select: (_columns, options) => { count = !!options?.count; return q; },
        eq: (key, value) => { op.filters.push(['eq', key, value]); return q; },
        in: (key, value) => { op.filters.push(['in', key, value]); return q; },
        not: key => { op.filters.push(['not', key]); return q; },
        is: (key, value) => { op.filters.push(['eq', key, value]); return q; },
        order: () => q, limit: () => q, lt: () => q, gt: () => q, gte: () => q, or: () => q,
        insert: payload => { op.kind = 'insert'; op.payload = payload; return q; },
        update: payload => { op.kind = 'update'; op.payload = payload; return q; },
        single: async () => { asSingle = true; return execute(); },
        maybeSingle: async () => {
          asSingle = true; const result = execute();
          if (table === 'orders' && op.kind === 'select' && op.filters.some(([kind, key, value]) => kind === 'eq' && key === 'status' && value === 'payment_pending') && state.orderReadGate) await state.orderReadGate();
          return result;
        },
        then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
      };
      return q;
    },
    async rpc(name, args) {
      ops.push({ rpc: name, args });
      if (name === 'claim_platform_fee_snapshots') return state.platformFeeQueueError ? {data:null,error:{message:'synthetic fee queue unavailable'}} : {data:[],error:null};
      if (name === 'claim_ticket_receipts') return state.receiptQueueError ? {data:null,error:{message:'synthetic queue unavailable'}} : {data:[],error:null};
      if (name === 'list_paid_cart_recovery_candidates') {
        if (state.candidateError) return { data: null, error: { message: 'recovery selector unavailable' } };
        return { data: recoveryCandidate && ['payment_pending', 'payment_failed'].includes(order.status) ? [{ ...order }] : [], error: null };
      }
      if (name === 'cart_release_hold') {
        hold.released = true;
        if (cart.status !== 'completed') cart.status = 'abandoned';
        return { data: { ok: true }, error: null };
      }
      if (name === 'upsert_order_money_state') {
        if (state.moneyError) return { data: null, error: { message: 'money RPC unavailable' } };
        if (order.last_event_at && args.p_event_created_at <= order.last_event_at) return { data: false, error: null };
        order.status = args.p_status;
        order.last_event_at = args.p_event_created_at;
        return { data: true, error: null };
      }
      if (name === 'complete_paid_cart_atomic') {
        if (state.issuanceGate) await state.issuanceGate();
        const result = allocationLock.then(() => {
          if (state.issuanceError) return { data: null, error: { message: 'allocation unavailable' } };
          if (cart.status === 'completed') return { data: { ok: true, duplicate: true, issuedCount: 0 }, error: null };
          if (tickets.length || addons.length) return { data: { ok: false, error: 'incomplete_issuance' }, error: null };
          if (!state.inventoryAvailable) return { data: { ok: false, error: 'insufficient_inventory' }, error: null };
          if (args.p_payment_intent_id !== cart.stripe_pi_id || args.p_currency !== cart.currency ||
              args.p_amount_received !== cart.total_cents || args.p_event_id !== cart.event_id || args.p_user_id !== cart.user_id) {
            return { data: { ok: false, error: 'payment_contract_mismatch' }, error: null };
          }
          if (['refunded', 'cancelled'].includes(order.status)) return { data: { ok: false, error: 'order_terminal' }, error: null };
          assert.equal(args.p_payment_intent_id, cart.stripe_pi_id);
          tickets.push(...args.p_ticket_rows);
          addons.push(...args.p_addon_rows);
          cart.status = 'completed'; order.status = 'paid'; hold.released = true;
          return { data: { ok: true, duplicate: false, issuedCount: tickets.length }, error: null };
        });
        allocationLock = result.then(() => {});
        return result;
      }
      return { data: null, error: null };
    },
  };
  const h = harness({ database: db, stripeFetch: async (url, init) => {
    assert.ok(['https://api.stripe.com/v1/payment_intents/pi_fixture?expand[]=latest_charge', 'https://api.stripe.com/v1/payment_intents/pi_fixture'].includes(url), `unexpected Stripe request ${url}`);
    assert.ok(!init.method || init.method === 'GET', 'verification may only read Stripe');
    return state.stripeError ? Response.json({ error: { message: 'unavailable' } }, { status: 503 }) : Response.json(currentPayment);
  }, dependencyOverrides: {
    'order-state.ts': undefined,
    'heartbeat.ts': { withHeartbeat: async (_name, fn) => fn(), tryClaimJob: async () => true, releaseJob: async () => {} },
    'sentry.ts': { withSentry: (_name, fn) => fn, captureEdge: async err => { captures.push(err); } },
    'stripe-processing-fee.ts': { syncOrderStripeProcessingFeeSafely: async () => {} },
  } });
  const epoch = Math.floor(Date.now() / 1000);
  async function run(type, { eventId = `evt_${type.replaceAll('.', '_')}`, age = 0, piStatus, invalidSignature = false } = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const object = { id: 'pi_fixture', status: piStatus || (type.endsWith('.succeeded') ? 'succeeded' : 'requires_payment_method'),
      amount: 2250, amount_received: type.endsWith('.succeeded') ? 2250 : 0, currency: 'usd',
      metadata: { type: 'cart_checkout', cart_id: cart.id, event_id: '7', user_id: 'member_fixture' },
      ...(type.endsWith('.payment_failed') ? { last_payment_error: { type: 'card_error', code: 'card_declined', decline_code: 'generic_decline' } } : {}) };
    const body = JSON.stringify({ id: eventId, type, created: epoch + age, data: { object } });
    const signature = createHmac('sha256', invalidSignature ? 'wrong-secret' : 'test').update(`${timestamp}.${body}`).digest('hex');
    return h.invoke('stripe-webhook', body, { 'stripe-signature': `t=${timestamp},v1=${signature}` });
  }
  return { run, reconcile: (headers = { 'x-cron-secret': 'test' }) => h.invoke('reconcile-orders', {}, headers), captures, order, cart, hold, lines, tickets, addons, timeline, ops, events, state, requests: h.requests, currentPayment };
}

module.exports = { fixture };
