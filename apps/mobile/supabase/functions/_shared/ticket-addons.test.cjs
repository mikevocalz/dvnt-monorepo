// What a ticket holder sees of their add-ons: get-guest-ticket and the Apple
// wallet pass both read through _shared/ticket-addons.ts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness } = require('./payment-safety.test.cjs');

const ROWS = [
  { id: 'a', quantity: 1, status: 'unfulfilled', qr_token: 'qa', qr_payload: 'pa',
    ticket_addons: { name: 'Drink', is_redeemable: true }, ticket_addon_variants: null },
  { id: 'b', quantity: 1, status: 'unfulfilled', qr_token: 'qb', qr_payload: 'pb',
    ticket_addons: [{ name: 'Drink', is_redeemable: true }], ticket_addon_variants: null },
  { id: 'c', quantity: 2, status: 'redeemed', qr_token: 'qc', qr_payload: 'pc',
    ticket_addons: { name: 'Drink', is_redeemable: true }, ticket_addon_variants: null },
  { id: 'd', quantity: 1, status: 'fulfilled', qr_token: null, qr_payload: null,
    ticket_addons: { name: 'Shirt', is_redeemable: false }, ticket_addon_variants: { name: 'M' } },
];

function db(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table };
      calls.push(call);
      const q = {
        select: (s) => { call.select = s; return q; },
        or: (f) => { call.or = f; return q; },
        order: () => q,
        then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      };
      return q;
    },
  };
}

const mod = () => harness().load(path.resolve(__dirname, 'ticket-addons.ts'));

test('loads add-ons bound to the ticket plus unbound rows on its cart, never another ticket\'s', async () => {
  const d = db(ROWS);
  const addons = await mod().loadTicketAddons(d, { id: 'tk', cart_id: 'cart' });
  assert.equal(d.calls[0].table, 'order_addons');
  assert.equal(d.calls[0].or, 'ticket_id.eq.tk,and(cart_id.eq.cart,ticket_id.is.null)');
  assert.equal(addons.length, 4);
  assert.equal(addons[0].qrPayload, 'pa', 'the signed payload is what ticket-scan verifies');
  assert.equal(addons[3].variantName, 'M');

  const solo = db([]);
  await mod().loadTicketAddons(solo, { id: 'tk', cart_id: null });
  assert.equal(solo.calls[0].or, 'ticket_id.eq.tk');
});

test('pass lines sum usable units and drop redeemed rows', async () => {
  const m = mod();
  const addons = await m.loadTicketAddons(db(ROWS), { id: 'tk', cart_id: 'cart' });
  assert.deepEqual([...m.addonPassLines(addons)], ['2 × Drink', '1 × Shirt (M)']);
});
