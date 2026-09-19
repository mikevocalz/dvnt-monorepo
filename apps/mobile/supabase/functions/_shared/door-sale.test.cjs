const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Same transpile-and-load pattern as comp-recipients.test.cjs: the helper
// under test stays pure (no imports) so it can run under plain node.
function load() {
  const source = ts.transpileModule(
    fs.readFileSync(`${__dirname}/door-sale.ts`, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', source)(mod.exports, mod);
  return mod.exports;
}
const { parseDoorSaleMetadata, doorGuestTicketBase, maskEmail } = load();

// ── parseDoorSaleMetadata ────────────────────────────────────────────────

test('door-sale metadata resolves a guest buyer and a separate seller', () => {
  const parsed = parseDoorSaleMetadata({
    type: 'event_ticket',
    is_door_sale: 'true',
    guest_email: 'Guest@Example.com',
    guest_name: 'Guest Person',
    sold_by_staff_user_id: 'staff-123',
  });
  assert.equal(parsed.isDoorSale, true);
  assert.equal(parsed.userId, null);
  assert.equal(parsed.guestEmail, 'guest@example.com');
  assert.equal(parsed.guestName, 'Guest Person');
  assert.equal(parsed.soldByStaffUserId, 'staff-123');
});

test('a regular (non-door) PI is untouched', () => {
  const parsed = parseDoorSaleMetadata({
    type: 'event_ticket',
    user_id: 'buyer-9',
  });
  assert.equal(parsed.isDoorSale, false);
  assert.equal(parsed.userId, 'buyer-9');
  assert.equal(parsed.guestEmail, null);
  assert.equal(parsed.soldByStaffUserId, null);
});

test('a door sale with no guest email is refused — tickets need somewhere to go', () => {
  const parsed = parseDoorSaleMetadata({ is_door_sale: 'true' });
  assert.equal(parsed.isDoorSale, true);
  assert.equal(parsed.guestEmail, null);
  assert.equal(doorGuestTicketBase.valid(parsed), false);
});

// ── doorGuestTicketBase ──────────────────────────────────────────────────

test('door ticket rows never carry the seller as owner', () => {
  const base = doorGuestTicketBase.build({
    eventId: 42,
    ticketTypeId: 'tt-1',
    guestEmail: 'guest@example.com',
    guestName: 'G',
    paymentIntentId: 'pi_1',
    quantity: 2,
    amountCents: 9001,
    index: 0,
  });
  assert.equal(base.user_id, null);
  assert.equal(base.guest_email, 'guest@example.com');
  assert.equal(base.event_id, 42);
  assert.equal(base.stripe_payment_intent_id, 'pi_1');
  assert.equal(base.status, 'active');
  assert.ok(base.guest_lookup_token, 'guest lookup token minted');
});

test('per-ticket amounts split deterministically and sum to the charge', () => {
  const rows = [0, 1, 2].map((i) =>
    doorGuestTicketBase.build({
      eventId: 1, ticketTypeId: 't', guestEmail: 'g@x.co', guestName: null,
      paymentIntentId: 'pi_2', quantity: 3, amountCents: 10000, index: i,
    }),
  );
  const sum = rows.reduce((s, r) => s + r.purchase_amount_cents, 0);
  assert.equal(sum, 10000);
  // deterministic: first rows absorb the remainder
  assert.deepEqual(rows.map((r) => r.purchase_amount_cents), [3334, 3333, 3333]);
});

// ── maskEmail ────────────────────────────────────────────────────────────

test('maskEmail hides all but the first character of the local part', () => {
  assert.equal(maskEmail('jay@mail.com'), 'j***@mail.com');
  assert.equal(maskEmail('a@b.co'), 'a***@b.co');
  assert.equal(maskEmail('not-an-email'), 'not-an-email');
});
