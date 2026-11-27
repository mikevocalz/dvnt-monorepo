import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrivateStaffEmailTick } from './dvnt-private-staff-email-tick.mjs';
const base = {
  DVNT_ENVIRONMENT: 'private-staging',
  DVNT_PRIVATE_STAFF_EMAIL_SCHEDULER: 'true',
  DVNT_STAFF_EMAIL_WORKER_ORIGIN: 'https://private-stage.example.invalid',
  DVNT_STAFF_EMAIL_WEB_ORIGIN: 'https://private-stage.example.invalid',
  DVNT_STAFF_EMAIL_WORKER_TOKEN: 'a'.repeat(43),
};
const noCall = () => { throw new Error('Unexpected request'); };

test('disabled and bad destinations do not send the bearer', async () => {
  assert.equal(await runPrivateStaffEmailTick({}, noCall), 'disabled');
  for (const env of [
    { DVNT_ENVIRONMENT: 'production' },
    { DVNT_STAFF_EMAIL_WEB_ORIGIN: 'https://other.example.invalid' },
    { DVNT_STAFF_EMAIL_WORKER_TOKEN: 'short' },
    ...['https://dvntapp.live','https://dev.dvntapp.live','https://deviant.live',
      'https://private-stage.example.invalid/other','https://name@private-stage.example.invalid','http://localhost:3000']
      .map(url => ({ DVNT_STAFF_EMAIL_WORKER_ORIGIN: url, DVNT_STAFF_EMAIL_WEB_ORIGIN: url })),
  ]) assert.equal(await runPrivateStaffEmailTick({ ...base, ...env }, noCall), 'misconfigured');
});

test('sends only one bounded, authenticated, bodyless POST to the exact worker', async () => {
  let calls = 0;
  assert.equal(await runPrivateStaffEmailTick(base, async (url, init) => {
    calls++;
    assert.equal(url, base.DVNT_STAFF_EMAIL_WORKER_ORIGIN + '/staff-email/worker');
    assert.equal(init.method, 'POST');
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(init.headers, { Authorization: 'Bearer ' + base.DVNT_STAFF_EMAIL_WORKER_TOKEN });
    return new Response(null, { status: 204 });
  }), 'completed');
  assert.equal(calls, 1);
});

test('ambiguous response or error is reported without an inline retry', async () => {
  for (const outcome of [200, 302, 404, 503, 'failed']) {
    let calls = 0;
    assert.equal(await runPrivateStaffEmailTick(base, async () => {
      calls++;
      if (outcome === 'failed') throw new Error('private provider response');
      return new Response(null, { status: outcome });
    }), 'failed');
    assert.equal(calls, 1);
  }
});
