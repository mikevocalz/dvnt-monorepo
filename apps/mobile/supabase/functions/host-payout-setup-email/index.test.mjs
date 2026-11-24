import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostPayoutSetupEmailHandler } from '../_shared/host-payout-setup-email.ts';

const connected = { hostId: 'fixture_host', email: 'host@example.invalid', accountId: 'acct_123456789abc' };
const incomplete = { id: connected.accountId, object: 'account', metadata: { dvnt_host_id: connected.hostId },
 payouts_enabled: false, charges_enabled: false, details_submitted: false,
 requirements: { currently_due: ['external_account'], past_due: [], pending_verification: [], disabled_reason: null } };
function fixture(opts = {}) {
  const calls = [];
  let claimed = false;
  let host = opts.host === undefined ? { ...connected, accountId: null } : opts.host;
  const handler = createHostPayoutSetupEmailHandler({
    authorized: r => r.headers.get('authorization') === 'fake-service', sendEnabled: opts.enabled ?? true,
    async candidate(event) { calls.push(['candidate', event]); return host; },
    async lookup(id) { calls.push(['lookup', id]); if (opts.lookupThrows) throw Error(); return opts.stripe ?? incomplete; },
    async claim(event, h) {
      calls.push(['claim', event, h]); if (claimed || opts.claimLost) return null;
      claimed = true;
      return 'fixture-delivery';
    },
    async send(mail) { calls.push(['send', mail]); if (opts.sendThrows) throw Error(); return opts.noReceipt ? null : 'fixture-receipt'; },
    async accepted(id, receipt) { calls.push(['accepted', id, receipt]); if (opts.recordThrows) throw Error(); },
  });
  const call = (mode, extra = {}, auth = 'fake-service') => handler(new Request('https://fixture.invalid', {
    method: 'POST', headers: { authorization: auth }, body: JSON.stringify({ eventId: 4, mode, ...extra }),
  }));
  return { calls, call, changeHost: h => { host = h; } };
}
async function preview(f) { return (await (await f.call('preview')).json()).approvalFingerprint; }

test('unprivileged POST, invalid IDs and disabled send do not consult data or providers', async () => {
  const f = fixture({ enabled: false });
  assert.equal((await f.call('preview', {}, 'browser-token')).status, 401);
  for (const eventId of ['004', 0, 2147483648, 4.5]) assert.equal((await f.call('preview', { eventId })).status, 400);
  assert.equal((await f.call('send', { approvalFingerprint: 'a'.repeat(64) })).status, 403);
  assert.deepEqual(f.calls, []);
});
test('preview uses only verified candidate, never claims, sends, or queries a missing Connect account', async () => {
  const f = fixture();
  const r = await (await f.call('preview', { recipient: 'override@example.invalid' })).json();
  assert.equal(r.result, 'review_required');
  assert.equal(r.recipient, connected.email);
  assert.match(r.html, /\/feed\/events\/organizer-setup/);
  assert.match(r.html, /not a payment confirmation/);
  assert.match(r.approvalFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.calls, [['candidate', 4]]);
});
test('operator approval binds changed email/account/event and cannot be used for a different target', async () => {
  const f = fixture(), hash = await preview(f);
  assert.equal((await f.call('send', { eventId: 5, approvalFingerprint: hash })).status, 409);
  f.changeHost({ ...connected, accountId: null, email: 'new@example.invalid' });
  assert.equal((await f.call('send', { approvalFingerprint: hash })).status, 409);
  f.changeHost(connected);
  assert.equal((await f.call('send', { approvalFingerprint: hash })).status, 409);
  assert.ok(!f.calls.some(c => c[0] === 'claim'));
});
test('Stripe must still require action at send time', async () => {
  let current = incomplete;
  const f = fixture({ host: connected, get stripe() { return current; } });
  const hash = await preview(f);
  current = { ...incomplete, payouts_enabled: true, charges_enabled: true, details_submitted: true };
  assert.equal((await (await f.call('send', { approvalFingerprint: hash })).json()).result, 'no_action_needed');
  assert.ok(!f.calls.some(c => c[0] === 'claim'));
});
test('wrong Stripe owner and lookup outage fail closed; review and other disabled reasons are quiet', async () => {
  for (const opts of [
    { lookupThrows: true },
    { stripe: { ...incomplete, metadata: { dvnt_host_id: 'wrong' } } },
    { stripe: { ...incomplete, requirements: undefined } },
  ]) assert.equal((await fixture({ host: connected, ...opts }).call('preview')).status, 503);
  for (const requirements of [
    { currently_due: [], past_due: [], pending_verification: ['document'], disabled_reason: 'requirements.pending_verification' },
    { ...incomplete.requirements, disabled_reason: 'rejected.fraud' },
  ]) assert.equal((await (await fixture({ host: connected, stripe: { ...incomplete, requirements } }).call('preview')).json()).result, 'no_action_needed');
  assert.equal((await (await fixture({ host: null }).call('preview')).json()).result, 'ineligible');
});
test('concurrent sends get one claim and one accepted provider submission', async () => {
  const f = fixture(), approvalFingerprint = await preview(f);
  const replies = await Promise.all([1, 2].map(() => f.call('send', { approvalFingerprint }).then(r => r.json())));
  assert.deepEqual(replies.map(r => r.result).sort(), ['already_claimed_or_ineligible', 'provider_accepted']);
  const sent = f.calls.filter(c => c[0] === 'send');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].idempotencyKey, 'host-payout-setup:v1:fixture-delivery');
  assert.deepEqual(f.calls.find(c => c[0] === 'accepted'), ['accepted', 'fixture-delivery', 'fixture-receipt']);
});
for (const [opts, expected] of [
  [{ claimLost: true }, 'already_claimed_or_ineligible'],
  [{ sendThrows: true }, 'reconcile_required'],
  [{ noReceipt: true }, 'reconcile_required'],
  [{ recordThrows: true }, 'accepted_record_pending'],
]) test(`failure never blindly sends again: ${expected}`, async () => {
  const f = fixture(opts), approvalFingerprint = await preview(f);
  assert.equal((await (await f.call('send', { approvalFingerprint })).json()).result, expected);
  assert.equal((await (await f.call('send', { approvalFingerprint })).json()).result, 'already_claimed_or_ineligible');
  assert.equal(f.calls.filter(c => c[0] === 'send').length, opts.claimLost ? 0 : 1);
});

test('verification at send time suppresses a previously approved setup email even if due lists are populated', async () => {
  let current = incomplete;
  const f = fixture({ host: connected, get stripe() { return current; } });
  const hash = await preview(f);
  current = { ...incomplete, requirements: {
    currently_due: ['external_account'], past_due: ['external_account'],
    pending_verification: ['external_account'], disabled_reason: 'requirements.pending_verification',
  } };
  assert.equal((await (await f.call('send', { approvalFingerprint: hash })).json()).result, 'no_action_needed');
  assert.ok(!f.calls.some(c => ['claim', 'send'].includes(c[0])));
});

test('overlapping pending fields are quiet; a distinct overdue requirement remains actionable outside explicit review', async () => {
  const requirements = { currently_due: ['document'], past_due: ['document'],
    pending_verification: ['document'], disabled_reason: 'requirements.past_due' };
  const quiet = fixture({ host: connected, stripe: { ...incomplete, requirements } });
  assert.equal((await (await quiet.call('preview')).json()).result, 'no_action_needed');
  const actionable = fixture({ host: connected, stripe: { ...incomplete, requirements: {
    ...requirements, past_due: ['document', 'external_account'],
  } } });
  assert.equal((await (await actionable.call('preview')).json()).result, 'review_required');
  assert.ok(!actionable.calls.some(c => ['claim', 'send'].includes(c[0])));
});
