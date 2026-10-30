const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness } = require('./payment-safety.test.cjs');

function fixture(rows, messageId = "fixture-id") {
  const sent = [];
  const order = { id: 'order', event_id: 1, status: 'paid', guest_email: 'original@example.test', quantity: rows.length, total_cents: 1000, currency: 'usd' };
  const db = { from(table) {
    const q = { select: () => q, eq: () => q, order: () => q, update: value => { if (table === "orders") Object.assign(order, value); return q; }, insert: () => q,
      maybeSingle: async () => ({ data: table === 'orders' ? order : { title: 'Fixture' }, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: table === 'tickets' ? rows : null, error: null }).then(resolve, reject) };
    return q;
  }};
  const h = harness({ dependencyOverrides: {
    'send-resend-email.ts': { ticketConfirmation: data => ({ fixture: data }), sendResendEmail: async mail => { sent.push(mail); return messageId; } },
  }});
  const helper = h.load(path.join(__dirname, 'ticket-email-delivery.ts'));
  return { sent, order, bundle: () => helper.loadOrderTicketBundle(db, 'order'), deliver: () => helper.deliverTicketBundleEmail(db, 'order', { force: true }) };
}
const row = (id, extra = {}) => ({ id, status: 'active', qr_token: `qr-${id}`, guest_lookup_token: `lookup-${id}`, transferred_from: null, ...extra });

test('original buyer resend never includes an accepted-transfer recipient’s rotated QR', async () => {
  const f = fixture([row('retained'), row('transferred', { transferred_from: 'original-owner', guest_lookup_token: null })]);
  assert.deepEqual(Array.from((await f.bundle()).tickets, t => t.id), ['retained']);
  assert.equal((await f.deliver()).ok, true);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(Array.from(f.sent[0].fixture.tickets, t => t.qrToken), ['qr-retained']);
});

test('an order containing only transferred tickets sends no credentials to the original buyer', async () => {
  const f = fixture([row('transferred', { transferred_from: 'original-owner' })]);
  assert.equal((await f.deliver()).ok, false);
  assert.equal(f.sent.length, 0);
});

test('untransferred guest and claimed-owner tickets remain deliverable; invalid credentials do not', async () => {
  const f = fixture([row('guest'), row('claimed', { user_id: 'original-owner' }), row('pending', { status: 'transfer_pending' }), row('refunded', { status: 'refunded' }), row('void', { status: 'void' })]);
  assert.deepEqual(Array.from((await f.bundle()).tickets, t => t.id), ['guest', 'claimed']);
});

for (const messageId of [null, '']) test(`missing provider receipt (${JSON.stringify(messageId)}) never marks email sent`, async () => {
  const f = fixture([row('guest')], messageId);
  assert.equal((await f.deliver()).ok, false);
  assert.equal(f.order.ticket_email_status, 'failed');
});
