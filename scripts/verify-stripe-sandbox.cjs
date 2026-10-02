// Real Stripe test-mode smoke checks. This does not certify Connect, app auth,
// database issuance or webhook delivery. Never point this at a live CLI profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('../apps/mobile/node_modules/typescript');
const config = process.env.DVNT_SANDBOX_CONFIG;
assert.ok(config, 'Set DVNT_SANDBOX_CONFIG to the isolated sandbox CLI config');
const configText = fs.readFileSync(config, 'utf8');
assert.match(configText, /test_mode_api_key\s*=\s*["'](?:rkcs|rk|sk)_test_/);
assert.ok(!/(?:sk|rk)_live_/.test(configText), 'Refusing a configuration with live keys');
const runId = `dvnt-safety-${Date.now()}`;
function api(endpoint, params, method = 'post', allowError = false) {
  const args = ['--config', config, method, endpoint];
  for (const [key, value] of Object.entries(params || {})) args.push('-d', `${key}=${value}`);
  let output;
  try { output = execFileSync('stripe', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { output = e.stdout?.toString(); if (!output) throw new Error('Stripe CLI request failed'); }
  const result = JSON.parse(output);
  if (result.error && !allowError) {
    throw new Error(`${result.error.type}: ${result.error.code || 'Stripe refused request'}`);
  }
  if ('livemode' in result) assert.equal(result.livemode, false, 'Refusing live-mode object');
  return result;
}
function load(name) {
  const filename = path.join(__dirname, '../apps/mobile/supabase/functions/_shared', name);
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', source)(exports);
  return exports;
}
const { computeFeesWithMode } = load('fee-calculator.ts');
const { computePromoterCommission } = load('promoter-commission.ts');
const { checkoutTicketLines } = load('checkout-line-items.ts');
const pricing = computePromoterCommission({ lines: [{ eligibleAmountCents: 5000 }],
  customerDiscountBps: 1000, promoterCommissionBps: 1000 });
const fees = computeFeesWithMode(pricing.discountedAmountCents, 1, 'pass');
assert.equal(pricing.commissionAmountCents, 450);
assert.equal(fees.customer_charge_amount, 4713);
const created = [];
const evidence = { runId, scope: 'Real Stripe test-mode payments; no Connect or DVNT database/webhook integration',
  pricing: { subtotal: 5000, discount: 500, commission: 450, charge: 4713 }, checks: [] };
function intent(scenario) {
  const pi = api('/v1/payment_intents', { amount: fees.customer_charge_amount, currency: 'usd',
    'automatic_payment_methods[enabled]': true, 'metadata[dvnt_test_run]': runId,
    'metadata[dvnt_test_scenario]': scenario });
  assert.equal(pi.livemode, false); created.push(pi.id); return pi;
}
try {
  const success = intent('success');
  const paid = api(`/v1/payment_intents/${success.id}/confirm`, {
    payment_method: 'pm_card_visa', return_url: 'https://example.test/stripe-return',
  });
  assert.equal(paid.status, 'succeeded'); assert.equal(paid.amount_received, 4713);
  const readback = api(`/v1/payment_intents/${success.id}`, {}, 'get');
  assert.equal(readback.latest_charge, paid.latest_charge);
  evidence.checks.push({ scenario: 'success', id: paid.id, status: paid.status, amount_received: paid.amount_received, livemode: paid.livemode });

  const decline = intent('decline');
  const rejected = api(`/v1/payment_intents/${decline.id}/confirm`, {
    payment_method: 'pm_card_chargeDeclined', return_url: 'https://example.test/stripe-return',
  }, 'post', true);
  assert.equal(rejected.error?.code, 'card_declined');
  const failed = api(`/v1/payment_intents/${decline.id}`, {}, 'get');
  assert.equal(failed.status, 'requires_payment_method'); assert.equal(failed.amount_received, 0);
  evidence.checks.push({ scenario: 'decline', id: failed.id, status: failed.status, amount_received: 0, error: 'card_declined', livemode: failed.livemode });

  const unconfirmed = intent('cancel');
  const canceled = api(`/v1/payment_intents/${unconfirmed.id}/cancel`, {});
  assert.equal(canceled.status, 'canceled'); assert.equal(canceled.amount_received, 0);
  evidence.checks.push({ scenario: 'cancel', id: canceled.id, status: canceled.status, amount_received: 0, livemode: canceled.livemode });

  // Test Stripe accepting the application's exact remainder-cent lines.
  const lines = checkoutTicketLines(850, 3, 'usd', 'DVNT sandbox admission');
  const session = api('/v1/checkout/sessions', { mode: 'payment', ...lines.params,
    success_url: 'https://example.test/success', cancel_url: 'https://example.test/cancel',
    'metadata[dvnt_test_run]': runId, integration_identifier: 'dvnt_sandbox_abcdefgh' });
  assert.equal(session.livemode, false); assert.equal(session.amount_total, 850);
  api(`/v1/checkout/sessions/${session.id}/expire`, {});
  evidence.checks.push({ scenario: 'exact_checkout_line_total', id: session.id, amount_total: 850, livemode: false });
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  for (const id of created) {
    const pi = api(`/v1/payment_intents/${id}`, {}, 'get');
    if (!['succeeded', 'canceled'].includes(pi.status)) api(`/v1/payment_intents/${id}/cancel`, {});
  }
}
