// prepareCartAddonRows, reached through handleCartPaymentIntentSucceeded.
// redeem_addon spends a whole order_addons row on one scan, so a redeemable
// add-on line must reach complete_paid_cart_atomic with one prepared QR per
// unit (20261009100200 then writes one row per unit). Non-redeemable lines
// get no QR.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness } = require('./payment-safety.test.cjs');

function issuanceDb({ addonLines }) {
  const rpcs = [];
  return {
    rpcs,
    from() {
      const filters = { not: [] };
      const q = {
        select: () => q, eq: () => q, order: () => q, insert: () => q, update: () => q,
        not: (column) => { filters.not.push(column); return q; },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve, reject) => {
          const data = filters.not.includes('addon_id') ? addonLines : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, args) {
      rpcs.push({ name, args });
      return { data: { ok: true, duplicate: true, issuedCount: 0 }, error: null };
    },
  };
}

async function prepared(addonLines) {
  const db = issuanceDb({ addonLines });
  const h = harness({ database: db, stripeFetch: async () => Response.json({
    id: 'pi_1', status: 'succeeded', amount: 1000, amount_received: 1000, currency: 'usd',
    metadata: { type: 'cart_checkout', cart_id: 'cart', user_id: 'member', event_id: '1' },
    latest_charge: { payment_intent: 'pi_1', status: 'succeeded', paid: true, captured: true, refunded: false, amount_refunded: 0, disputed: false },
  }) });
  const mod = h.load(path.resolve(__dirname, 'cart-issuance.ts'));
  await mod.handleCartPaymentIntentSucceeded(db, { id: 'pi_1', metadata: { cart_id: 'cart', event_id: '1' } });
  const call = db.rpcs.find((c) => c.name === 'complete_paid_cart_atomic');
  assert.ok(call, 'complete_paid_cart_atomic was not called');
  return call.args.p_addon_rows;
}

test('a redeemable add-on line of 3 sends 3 distinct QRs', async () => {
  const rows = await prepared([
    { id: 'drinks', quantity: 3, ticket_addons: { event_id: 1, is_redeemable: true } },
  ]);
  assert.equal(rows.length, 3, `one QR per unit expected, got ${rows.length}`);
  assert.ok(rows.every((r) => r.line_item_id === 'drinks'));
  assert.equal(new Set(rows.map((r) => r.qr_token)).size, 3);
});

test('a non-redeemable add-on line sends no QR', async () => {
  const rows = await prepared([
    { id: 'shirt', quantity: 2, ticket_addons: { event_id: 1, is_redeemable: false } },
  ]);
  assert.equal(rows.length, 0);
});
