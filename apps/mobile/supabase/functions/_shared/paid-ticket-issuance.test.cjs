const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness } = require('./payment-safety.test.cjs');
const { issuePaidTicketsAtomically, paidTicketAmount } = harness().load(path.join(__dirname, 'paid-ticket-issuance.ts'));
const args = { orderId: 'order', ticketTypeId: 'tier', paymentIntentId: 'pi_fixture', checkoutSessionId: null, amountCents: 1001, ticketRows: [{ id: 'a' }, { id: 'b' }] };
const complete = { ok: true, duplicate: false, order_id: 'order', issued_count: 2, tickets: [{ id: 'a' }, { id: 'b' }] };

for (const [amount, qty, expected] of [[1001, 2, [501, 500]], [1001, 3, [334, 334, 333]], [1, 3, [1, 0, 0]], [1000, 2, [500, 500]]]) {
  test(`allocation preserves ${amount} cents across ${qty} tickets`, () => {
    const cents = Array.from({ length: qty }, (_, i) => paidTicketAmount(amount, qty, i));
    assert.deepEqual(cents, expected);
    assert.equal(cents.reduce((a, b) => a + b, 0), amount);
  });
}
for (const [amount, qty, i] of [[0, 1, 0], [-1, 1, 0], [1.5, 1, 0], [100, 0, 0], [100, 2, -1], [100, 2, 2], [Number.MAX_SAFE_INTEGER + 1, 2, 0]]) {
  test(`invalid amount allocation rejects ${amount}/${qty}/${i}`, () => assert.throws(() => paidTicketAmount(amount, qty, i)));
}

for (const delta of [{ order_id: 'other' }, { issued_count: 1 }, { tickets: [] }, { duplicate: true }, { terminal: true }, { issued_count: null }, { ok: false, error: 'hold_expired' }]) {
  test(`malformed or rejected RPC response never looks successful ${JSON.stringify(delta)}`, async () => {
    await assert.rejects(issuePaidTicketsAtomically({ rpc: async () => ({ data: { ...complete, ...delta }, error: null }) }, args));
  });
}
test('missing migration fails closed without direct-write fallback', async () => {
  let calls = 0;
  await assert.rejects(issuePaidTicketsAtomically({
    rpc: async () => { calls++; return { data: null, error: new Error('function does not exist') }; },
    from() { assert.fail('no fallback table writes'); },
  }, args), /function does not exist/);
  assert.equal(calls, 1);
});
for (const delta of [{ paymentIntentId: '' }, { amountCents: 0 }, { amountCents: 1.1 }]) {
  test(`invalid payment contract fails before RPC ${JSON.stringify(delta)}`, async () => {
    await assert.rejects(issuePaidTicketsAtomically({ rpc: () => assert.fail('invalid request reached database') }, { ...args, ...delta }));
  });
}
test('complete replay returns original bundle with zero new issuance', async () => {
  const result = await issuePaidTicketsAtomically({ rpc: async () => ({ data: { ...complete, duplicate: true, issued_count: 0 }, error: null }) }, args);
  assert.equal(result.duplicate, true);
  assert.equal(result.issued, 0);
  assert.equal(result.tickets.length, 2);
});
test('terminal replay explicitly returns no deliverable credentials', async () => {
  const result = await issuePaidTicketsAtomically({ rpc: async () => ({ data: { ...complete, terminal: true, duplicate: true, issued_count: 0, tickets: [] }, error: null }) }, args);
  assert.equal(result.terminal, true);
  assert.equal(result.tickets.length, 0);
});
