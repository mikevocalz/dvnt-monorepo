// Pure-function coverage for the 30-minute sales cutoff shared by every
// card-not-present rail (checkout, PI, cart, guest checkout, both RSVP
// paths, door POS quote/sell, upgrades). Tap to Pay is the only exception.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness } = require('./payment-safety.test.cjs');

const { isSalesClosed, salesCutoffAt, SALES_CUTOFF_MINUTES } =
  harness().load(path.resolve(__dirname, 'sales-cutoff.ts'));

const NOW = Date.parse('2026-09-22T20:00:00.000Z');
const iso = ms => new Date(NOW + ms).toISOString();

assert.equal(SALES_CUTOFF_MINUTES, 30);

for (const c of [
  { name: 'well before the window', event: { end_date: iso(2 * 3600_000) }, expected: false },
  { name: 'one minute outside the window', event: { end_date: iso(31 * 60_000) }, expected: false },
  { name: 'exactly at the cutoff', event: { end_date: iso(30 * 60_000) }, expected: true },
  { name: 'inside the window', event: { end_date: iso(10 * 60_000) }, expected: true },
  { name: 'after the event ends', event: { end_date: iso(-3600_000) }, expected: true },
  { name: 'start_date fallback open', event: { start_date: iso(2 * 3600_000) }, expected: false },
  { name: 'start_date fallback closed', event: { start_date: iso(10 * 60_000) }, expected: true },
  { name: 'end_date wins over start_date', event: { end_date: iso(2 * 3600_000), start_date: iso(60_000) }, expected: false },
  { name: 'date fallback', event: { date: iso(10 * 60_000) }, expected: true },
  { name: 'no dates → open', event: {}, expected: false },
  { name: 'null event → open', event: null, expected: false },
  { name: 'unparseable date → open', event: { end_date: 'not-a-date' }, expected: false },
]) {
  test(`isSalesClosed: ${c.name}`, () => {
    assert.equal(isSalesClosed(c.event, NOW), c.expected);
  });
}

test('salesCutoffAt anchors 30 min before the event end', () => {
  const cutoff = salesCutoffAt({ end_date: '2026-09-22T22:00:00.000Z' });
  assert.equal(cutoff.toISOString(), '2026-09-22T21:30:00.000Z');
});
