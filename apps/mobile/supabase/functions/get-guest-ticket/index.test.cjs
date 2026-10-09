// get-guest-ticket returns the add-ons the guest can use at the door: their
// own (bound to this ticket, or unbound on the same cart) with the signed
// payload ticket-scan verifies, and never another attendee's add-on.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../_shared/payment-safety.test.cjs');

const TOKEN = '0b5c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';

function db() {
  const addonRows = [
    { id: 'mine', ticket_id: 'tk', cart_id: 'cart', quantity: 1, status: 'unfulfilled',
      qr_token: 'q1', qr_payload: 'signed-1', ticket_addons: { name: 'Drink', is_redeemable: true },
      ticket_addon_variants: null },
    { id: 'theirs', ticket_id: 'tk-friend', cart_id: 'cart', quantity: 1, status: 'unfulfilled',
      qr_token: 'q2', qr_payload: 'signed-2', ticket_addons: { name: 'Drink', is_redeemable: true },
      ticket_addon_variants: null },
  ];
  return {
    from(table) {
      const f = { eq: {}, or: null };
      const q = {
        select: () => q, order: () => q,
        eq: (k, v) => { f.eq[k] = v; return q; },
        or: (expr) => { f.or = expr; return q; },
        maybeSingle: async () => ({ data: table === 'tickets' ? {
          id: 'tk', event_id: 3, status: 'active', qr_token: 't', qr_payload: 'tp', cart_id: 'cart',
          ticket_type: { name: 'GA' }, event: { title: 'Show' } } : null, error: null }),
        then: (resolve, reject) => {
          let rows = table === 'order_addons' ? addonRows : [];
          if (f.eq.cart_id) rows = rows.filter((r) => r.cart_id === f.eq.cart_id);
          if (f.or) {
            // Evaluate the PostgREST or() the handler built for this ticket.
            rows = rows.filter((r) => f.or.split(/,(?![^(]*\))/).some((part) => {
              const m = part.match(/^ticket_id\.eq\.(.+)$/);
              if (m) return r.ticket_id === m[1];
              const a = part.match(/^and\(cart_id\.eq\.(.+),ticket_id\.is\.null\)$/);
              return a ? r.cart_id === a[1] && r.ticket_id == null : false;
            }));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

test('a guest sees their own add-on with its signed payload, not a group member\'s', async () => {
  const h = harness({ database: db() });
  const r = await h.invoke('get-guest-ticket', { token: TOKEN });
  assert.equal(r.status, 200, await r.clone().text());
  const { ticket } = await r.json();
  assert.deepEqual(ticket.addons.map((a) => a.id), ['mine'],
    'another attendee\'s add-on QR was handed to this guest');
  assert.equal(ticket.addons[0].qrPayload, 'signed-1');
});
