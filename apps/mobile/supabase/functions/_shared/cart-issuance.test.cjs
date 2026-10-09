// prepareCartAddonRows, reached through handleCartPaymentIntentSucceeded.
// redeem_addon spends a whole order_addons row on one scan, so a redeemable
// add-on line must reach cart_complete_issuance with one prepared QR per
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
  const h = harness({ database: db });
  const mod = h.load(path.resolve(__dirname, 'cart-issuance.ts'));
  await mod.handleCartPaymentIntentSucceeded(db, { id: 'pi_1', metadata: { cart_id: 'cart', event_id: '1' } });
  const call = db.rpcs.find((c) => c.name === 'cart_complete_issuance');
  assert.ok(call, 'cart_complete_issuance was not called');
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
