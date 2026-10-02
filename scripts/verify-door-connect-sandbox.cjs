// Executes the real door-sell handler with fixture auth/database and real Stripe.
// This is NOT a deployed end-to-end test or an Express onboarding test.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { harness } = require('../apps/mobile/supabase/functions/_shared/payment-safety.test.cjs');
const config = process.env.DVNT_SANDBOX_CONFIG;
const expectedAccount = process.env.DVNT_SANDBOX_ACCOUNT;
const organizer = process.env.DVNT_SANDBOX_ORGANIZER;
assert.ok(config && expectedAccount && organizer, 'Provide isolated sandbox config/account/organizer');
const prefix = ['--config', config];
function cli(args) {
  let output;
  try { output = execFileSync('stripe', [...prefix, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { output = error.stdout?.toString(); if (!output) throw new Error('Stripe CLI failed'); }
  return JSON.parse(output);
}
const identity = cli(['whoami', '--format', 'json']);
assert.equal(identity.account_id, expectedAccount);
assert.equal(identity.mode, 'test');
function api(endpoint, params = {}, method = 'post', allowError = false) {
  const args = [method, endpoint];
  for (const [key, value] of Object.entries(params)) args.push('-d', `${key}=${value}`);
  const value = cli(args);
  if (value.error && !allowError) throw new Error(`${endpoint}: ${value.error.type}: ${value.error.code || ""}: ${value.error.message}`);
  if ('livemode' in value) assert.equal(value.livemode, false);
  return value;
}
assert.equal(api('/v1/balance', {}, 'get').livemode, false);
const endpoints = api('/v1/webhook_endpoints', { limit: 100 }, 'get');
assert.equal(endpoints.has_more, false);
assert.equal(endpoints.data.length, 0, 'Refusing sandbox with external webhook destinations');
const account = api(`/v1/accounts/${organizer}`, {}, 'get');
assert.equal(account.charges_enabled, true);
assert.equal(account.capabilities.transfers, 'active');
const created = [];
const evidence = { sandbox_account: expectedAccount, organizer, organizer_type: account.type,
  scope: 'Actual local door-sell handler + real sandbox Stripe; auth/database are fixtures, no webhook fulfillment', checks: [] };
async function stripeFetch(url, init) {
  assert.ok(url.startsWith('https://api.stripe.com/v1/'));
  const endpoint = url.slice('https://api.stripe.com'.length);
  const data = api(endpoint, Object.fromEntries(new URLSearchParams(init.body)), (init.method || 'GET').toLowerCase(), true);
  if (data.object === 'payment_intent' && !created.includes(data.id)) created.push(data.id);
  return Response.json(data, { status: data.error ? 400 : 200 });
}
async function sell(extra = {}) {
  const h = harness({ organizerAccountId: organizer, discountBps: 1000, stripeFetch, ...extra });
  const r = await h.invoke('door-sell', { action: 'sell', event_id: 1, ticket_type_id: 'tier',
    quantity: 2, guest_email: 'guest@example.com', guest_name: 'Sandbox Guest', promoter_code: 'CODE' });
  const body = await r.json();
  return { h, status: r.status, body };
}
(async () => {
  try {
    const success = await sell(); assert.equal(success.status, 200, JSON.stringify(success.body));
    assert.equal(success.body.quote.total_cents, 9425);
    const order = success.h.writes.find(w => w.table === 'orders').payload;
    assert.equal(order.promoter_commission_amount_cents, 900);
    assert.equal(order.user_id, null); assert.equal(order.sold_by_staff_user_id, 'staff');
    const pi = api(`/v1/payment_intents/${success.body.paymentIntentId}`, {}, 'get');
    assert.equal(pi.amount, 9425); assert.equal(pi.application_fee_amount, 850);
    assert.equal(pi.transfer_data.destination, organizer);
    assert.equal(pi.metadata.guest_email, 'guest@example.com');
    assert.equal(pi.metadata.user_id, undefined);
    const paid = api(`/v1/payment_intents/${pi.id}/confirm`, { payment_method: 'pm_card_visa', return_url: 'https://accessible.stripe.com' });
    assert.equal(paid.status, 'succeeded'); assert.equal(paid.amount_received, 9425);
    let charge = api(`/v1/charges/${paid.latest_charge}`, {}, 'get');
    // The destination transfer can appear shortly after the payment succeeds.
    for (let attempt = 0; !charge.transfer && attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      charge = api(`/v1/charges/${paid.latest_charge}`, {}, 'get');
    }
    assert.ok(charge.transfer, 'Destination transfer did not appear');
    const transfer = api(`/v1/transfers/${charge.transfer}`, {}, 'get');
    assert.equal(charge.application_fee_amount, 850);
    assert.equal(transfer.destination, organizer);
    assert.equal(transfer.amount - charge.application_fee_amount, 8575);
    evidence.checks.push({ scenario: 'door_destination_charge', payment_intent: pi.id, charge: charge.id,
      transfer: transfer.id, amount_received: paid.amount_received, application_fee: charge.application_fee_amount,
      organizer_net_before_own_fees: 8575, promoter_snapshot: 900, livemode: paid.livemode });

    const declined = await sell(); assert.equal(declined.status, 200);
    const rejected = api(`/v1/payment_intents/${declined.body.paymentIntentId}/confirm`, {
      payment_method: 'pm_card_chargeDeclined', return_url: 'https://accessible.stripe.com',
    }, 'post', true);
    assert.equal(rejected.error?.code, 'card_declined');
    const failed = api(`/v1/payment_intents/${declined.body.paymentIntentId}`, {}, 'get');
    assert.equal(failed.amount_received, 0); assert.equal(failed.status, 'requires_payment_method');
    evidence.checks.push({ scenario: 'door_decline', payment_intent: failed.id, status: failed.status, amount_received: 0, livemode: false });

    const before = created.length;
    const soldOut = await sell({ soldOut: true }); assert.equal(soldOut.status, 409);
    assert.equal(created.length, before + 1);
    const canceled = api(`/v1/payment_intents/${created[created.length - 1]}`, {}, 'get');
    assert.equal(canceled.status, 'canceled'); assert.equal(canceled.amount_received, 0);
    assert.ok(!soldOut.h.writes.some(w => w.table === 'orders'));
    evidence.checks.push({ scenario: 'lost_inventory_cancels_intent', payment_intent: canceled.id, status: canceled.status, amount_received: 0, livemode: false });
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    for (const id of created) {
      const pi = api(`/v1/payment_intents/${id}`, {}, 'get');
      if (!['succeeded', 'canceled'].includes(pi.status)) api(`/v1/payment_intents/${id}/cancel`);
    }
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
