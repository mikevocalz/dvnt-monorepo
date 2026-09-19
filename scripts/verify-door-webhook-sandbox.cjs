// Replays an authentic Stripe sandbox event through the real local webhook.
// The signature, database, QR signer and email delivery are local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHmac } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { harness } = require('../apps/mobile/supabase/functions/_shared/payment-safety.test.cjs');
const config = process.env.DVNT_SANDBOX_CONFIG;
assert.ok(config);
const evidence = JSON.parse(fs.readFileSync('docs/payments/2026-09-19-door-connect-sandbox-evidence.json'));
function get(endpoint, params = {}) {
  const args = ['--config', config, 'get', endpoint];
  for (const [k, v] of Object.entries(params)) args.push('-d', `${k}=${v}`);
  return JSON.parse(execFileSync('stripe', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}
assert.equal(get('/v1/balance').livemode, false);
const piId = evidence.checks[0].payment_intent;
const pi = get(`/v1/payment_intents/${piId}`);
assert.equal(pi.livemode, false);
const event = get('/v1/events', { type: 'payment_intent.succeeded', limit: 100 }).data.find(e => e.data.object.id === piId);
assert.ok(event, 'Sandbox success event not found'); assert.equal(event.livemode, false);
const rows = {
  tickets: [], stripe_events: [], order_timeline: [],
  orders: [{ id: 'order', stripe_payment_intent_id: piId, status: 'payment_pending', promoter_commission_amount_cents: 900 }],
  ticket_types: [{ id: 'tier', quantity_sold: 0, name: 'Sandbox Admission' }],
  ticket_holds: [{ payment_intent_id: piId, status: 'active' }],
  events: [{ id: 1, title: 'Sandbox event' }],
  promoter_attributions: [{ order_id: 'order', promoter_id: 'promoter', locked_rev_share_bps: 1000 }],
};
const ledger = [];
const database = {
  from(table) {
    const data = rows[table] ||= []; const filters = []; let action, payload, single = false;
    const matches = row => filters.every(([k, v]) => row[k] === v);
    const execute = () => {
      let found = data.filter(matches);
      if (action === 'insert') {
        const newRows = Array.isArray(payload) ? payload : [payload];
        if (table === 'stripe_events' && newRows.some(n => data.some(r => r.event_id === n.event_id))) return { error: { code: '23505' } };
        data.push(...newRows); found = newRows;
      } else if (action === 'update') found.forEach(r => Object.assign(r, payload));
      return { data: single ? found[0] || null : found, count: found.length, error: null };
    };
    const q = { eq: (k,v) => { filters.push([k,v]); return q; }, select: () => q,
      insert: p => { action = 'insert'; payload = p; return q; },
      update: p => { action = 'update'; payload = p; return q; },
      single: async () => { single = true; return execute(); },
      maybeSingle: async () => { single = true; return execute(); },
      then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject) };
    return q;
  },
  async rpc(name, args) {
    if (name === 'upsert_order_money_state') { rows.orders[0].status = args.p_status; return { data: true }; }
    if (name === 'record_promoter_attribution') return { data: { ok: true } };
    if (name === 'record_promoter_ledger_entry') { ledger.push(args); return { data: { applied: true } }; }
    throw new Error(`Unexpected RPC: ${name}`);
  },
};
const h = harness({ database, dependencyOverrides: { 'order-state.ts': undefined },
  stripeFetch: async url => Response.json(get(url.slice('https://api.stripe.com'.length))) });
const body = JSON.stringify(event);
const timestamp = Math.floor(Date.now()/1000);
const signature = createHmac('sha256','test').update(`${timestamp}.${body}`).digest('hex');
(async () => {
  for (let delivery = 0; delivery < 2; delivery++) {
    const response = await h.invoke('stripe-webhook', body, { 'stripe-signature': `t=${timestamp},v1=${signature}` });
    assert.equal(response.status, 200, await response.text());
    assert.equal(rows.tickets.length, 2);
    assert.equal(rows.ticket_types[0].quantity_sold, 2);
    assert.equal(rows.orders[0].status, 'paid');
    assert.equal(rows.ticket_holds[0].status, 'converted');
    assert.equal(ledger.length, 1); assert.equal(ledger[0].p_amount_cents, 900);
  }
  assert.ok(rows.tickets.every(t => t.user_id === null && t.guest_email === 'guest@example.com'));
  assert.equal(rows.tickets.reduce((sum,t) => sum+t.purchase_amount_cents,0),9425);
  console.log(JSON.stringify({ event: event.id, payment_intent: piId, livemode: false,
    scope: 'Actual webhook code, real sandbox event; fixture database, signature, QR and email',
    deliveries: 2, tickets: 2, ticket_owner: 'guest', seller_is_owner: false,
    ticket_amount_sum: 9425, order_status: 'paid', ledger_entries: 1, promoter_earning: 900 }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
