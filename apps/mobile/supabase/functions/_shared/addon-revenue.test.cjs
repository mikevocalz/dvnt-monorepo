const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const exports = {};
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'addon-revenue.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(source, { exports });
  return exports;
}

const { addonKeptCents, ADDON_REVENUE_SELECT } = load();

test('kept add-on revenue is unit price times quantity', () => {
  assert.equal(addonKeptCents({ status: 'unfulfilled', unit_price_cents: 1000, quantity: 1, refunded_amount_cents: 0 }), 1000);
  assert.equal(addonKeptCents({ status: 'redeemed', unit_price_cents: 500, quantity: 3, refunded_amount_cents: 0 }), 1500);
});

test('a partial refund comes off the line', () => {
  assert.equal(addonKeptCents({ status: 'fulfilled', unit_price_cents: 1000, quantity: 1, refunded_amount_cents: 400 }), 600);
});

test('a refunded row contributes nothing, even with refunded_amount_cents 0', () => {
  assert.equal(addonKeptCents({ status: 'refunded', unit_price_cents: 1000, quantity: 1, refunded_amount_cents: 0 }), 0);
  assert.equal(addonKeptCents({ status: 'refunded', unit_price_cents: 1000, quantity: 1, refunded_amount_cents: 1000 }), 0);
});

test('over-refunded and malformed rows clamp to zero', () => {
  assert.equal(addonKeptCents({ status: 'fulfilled', unit_price_cents: 1000, quantity: 1, refunded_amount_cents: 5000 }), 0);
  assert.equal(addonKeptCents({ status: 'fulfilled', unit_price_cents: null, quantity: null, refunded_amount_cents: null }), 0);
});

test('select list carries every column the formula reads', () => {
  for (const col of ['event_id', 'status', 'unit_price_cents', 'quantity', 'refunded_amount_cents']) {
    assert.match(ADDON_REVENUE_SELECT, new RegExp(`\\b${col}\\b`));
  }
});

test('get-host-dashboard adds add-on revenue to gross but never to sold counts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'get-host-dashboard', 'index.ts'), 'utf8');
  assert.match(src, /from "\.\.\/_shared\/addon-revenue\.ts"/);
  assert.match(src, /\.from\("order_addons"\)/);
  // sold counters only move inside the tickets loop.
  const addonBlock = src.slice(src.indexOf('.from("order_addons")'));
  assert.doesNotMatch(addonBlock.slice(0, addonBlock.indexOf('const now')), /\.sold\s*\+=|monthSold\s*\+=/);
});

test('payouts-release reads gross from recompute_event_financials, not a tickets-only sum', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'payouts-release', 'index.ts'), 'utf8');
  assert.match(src, /rpc\(\s*"recompute_event_financials"/);
  assert.match(src, /\.from\("event_financials"\)\s*\.select\(/);
  assert.doesNotMatch(src, /sum \+ \(t\.purchase_amount_cents/);
  assert.doesNotMatch(src, /\.from\("event_financials"\)\.upsert/);
});
