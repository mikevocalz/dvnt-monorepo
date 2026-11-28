import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessPromoter } from './payments/promoter-preflight.mjs';
const now = Date.parse('2030-01-20T00:00:00Z');
const scope = { eventId: 1001, promoterId: 'fixture-promoter' };
function fixture() {
  return { observedAt: new Date(now).toISOString(),
    event: { id: 1001, payoutStatus: 'pending', releaseAt: '2030-01-10T00:00:00Z', disputesClear: true },
    promoter: { id: scope.promoterId, eventId: scope.eventId, recipientCapabilityActive: true, recipientOwnershipVerified: true },
    runtime: { supabaseCronPresent: true, externalSchedulesReviewed: true, claimStatusAccepted: true },
    external: { quarantined: false, reported: false },
    entries: [{ id: 'fixture-earning', eventId: scope.eventId, promoterId: scope.promoterId,
      entryType: 'earning', amountCents: 1000, currency: 'usd', paidAt: null, transferId: null,
      externalSettlementId: null, status: 'pending' }] };
}
test('review-only even with every supplied gate true; no input mutation', () => {
  const s = fixture(); const before = structuredClone(s);
  const r = assessPromoter(s, scope, now);
  assert.equal(r.executionAllowed, false); assert.equal(r.status, 'review_required');
  assert.equal(r.unsettledLedgerCents, 1000); assert.deepEqual(s, before);
  assert.ok(r.blockers.includes('durable_per_promoter_claim_and_provider_recovery_required'));
});
for (const [name, mutate, code] of [
  ['missing release', s => s.event.releaseAt = null, 'release_date_missing_or_invalid'],
  ['future release', s => s.event.releaseAt = '2031-01-01', 'release_not_due'],
  ['event hold', s => s.event.payoutStatus = 'on_hold', 'event_not_pending'],
  ['external receipt', s => s.external.reported = true, 'external_payment_or_quarantine_review'],
  ['quarantine', s => s.external.quarantined = true, 'external_payment_or_quarantine_review'],
  ['unknown quarantine', s => delete s.external, 'external_payment_or_quarantine_review'],
  ['disputes unknown', s => delete s.event.disputesClear, 'dispute_review_required'],
  ['missing scheduler', s => s.runtime.supabaseCronPresent = false, 'supabase_schedule_not_verified'],
  ['external scheduler unknown', s => delete s.runtime.externalSchedulesReviewed, 'external_schedules_unverified'],
  ['rejected processing status', s => s.runtime.claimStatusAccepted = false, 'claim_status_contract_unverified'],
  ['old snapshot', s => s.observedAt = '2029-01-01', 'fresh_snapshot_required'],
  ['future snapshot', s => s.observedAt = '2031-01-01', 'fresh_snapshot_required'],
  ['legacy enabled flag insufficient', s => { delete s.promoter.recipientCapabilityActive; s.promoter.payoutsEnabled = true; }, 'recipient_capability_unverified'],
  ['recipient ownership unknown', s => delete s.promoter.recipientOwnershipVerified, 'recipient_ownership_unverified'],
  ['provider success without ledger stamp', s => s.entries[0].transferId = 'tr_fixture', 'prior_or_uncertain_settlement_review'],
  ['paid elsewhere', s => s.entries[0].externalSettlementId = 'fixture-receipt', 'prior_or_uncertain_settlement_review'],
  ['duplicate rows', s => s.entries.push({ ...s.entries[0] }), 'ledger_scope_or_economics_invalid'],
  ['wrong promoter', s => s.entries[0].promoterId = 'other', 'ledger_scope_or_economics_invalid'],
  ['wrong event', s => s.entries[0].eventId = 1002, 'ledger_scope_or_economics_invalid'],
  ['negative reversal', s => s.entries[0].amountCents = -100, 'ledger_scope_or_economics_invalid'],
  ['missing receipt field', s => delete s.entries[0].paidAt, 'prior_or_uncertain_settlement_review'],
]) test(name, () => { const s = fixture(); mutate(s); const r = assessPromoter(s, scope, now);
  assert.equal(r.executionAllowed, false); assert.ok(r.blockers.includes(code)); });
test('mixed currency and overflow never yield a usable amount', () => {
  for (const row of [{ currency: 'eur' }, { amountCents: Number.MAX_SAFE_INTEGER }]) {
    const s = fixture(); s.entries.push({ ...s.entries[0], id: 'second', ...row });
    assert.equal(assessPromoter(s, scope, now).unsettledLedgerCents, null);
  }
});
test('requires explicit scope and evidence', () => {
  for (const s of [null, {}, fixture()]) assert.equal(assessPromoter(s, null, now).executionAllowed, false);
  const s = fixture(); s.entries = []; assert.ok(assessPromoter(s, scope, now).blockers.includes('ledger_evidence_missing'));
});
test('module cannot acquire credentials or perform side effects', () => {
  const source = readFileSync(new URL('./payments/promoter-preflight.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(import|fetch|Deno|process|require)\b/);
});

import { previewTwoBusinessDays } from './payments/promoter-preflight.mjs';
const calendar = { from: '2030-01-01', through: '2030-12-31', holidays: [], timeZone: 'America/New_York' };
for (const [end, expected] of [['2030-01-04', '2030-01-08'], ['2030-01-05', '2030-01-08'], ['2030-01-07', '2030-01-09']]) {
  test(`future two-business-day preview ${end}`, () => {
    const result = previewTwoBusinessDays(end, calendar);
    assert.equal(result.localReleaseDate, expected); assert.equal(result.executionAllowed, false);
    assert.equal(result.historicalAutoRelease, false);
  });
}
test('reviewed holidays do not count as business days', () => {
  assert.equal(previewTwoBusinessDays('2030-01-04', { ...calendar, holidays: ['2030-01-07'] }).localReleaseDate, '2030-01-09');
});
test('no guessed calendar, timezone, invalid date, or UTC-to-local coercion', () => {
  for (const [date, c] of [['2030-01-04', null], ['2030-02-30', calendar], ['2030-01-04T23:00:00Z', calendar],
    ['2030-01-04', { ...calendar, timeZone: 'invalid' }], ['2030-01-04', { ...calendar, through: '2030-01-05' }]]) {
    assert.throws(() => previewTwoBusinessDays(date, c));
  }
});

import { evaluateFuturePromoterSchedule } from './payments/promoter-preflight.mjs';
const futureEvent = {
  id: 123, status: 'active', payoutStatus: 'pending', disputesClear: true,
  startAt: '2030-01-04T21:00:00-05:00', endAt: '2030-01-05T03:00:00Z', timeZone: calendar.timeZone,
};
const futurePolicy = { effectiveAt: '2030-01-04T00:00:00Z', calendar };
test('uses event-local dates and waits until the second local business day', () => {
  const scheduled = evaluateFuturePromoterSchedule(futureEvent,futurePolicy,Date.parse('2030-01-08T04:59:59Z'));
  assert.deepEqual(scheduled, {status:'scheduled', blocker:null, localEndDate:'2030-01-04',
    localReleaseDate:'2030-01-08', timeZone:'America/New_York', executionAllowed:false});
  const due=evaluateFuturePromoterSchedule(futureEvent,futurePolicy,Date.parse('2030-01-08T05:00:00Z'));
  assert.deepEqual(due, {...scheduled,status:'due_for_checks'});
});
test('reviewed holidays and DST do not shift the release to the prior calendar day', () => {
  const event={...futureEvent,startAt:'2030-03-08T21:00:00-05:00',endAt:'2030-03-09T07:00:00Z'};
  const policy={...futurePolicy,calendar:{...calendar,holidays:['2030-03-11']}};
  const check=now=>evaluateFuturePromoterSchedule(event,policy,Date.parse(now));
  assert.equal(check('2030-03-13T03:59:59Z').status,'scheduled');
  assert.equal(check('2030-03-13T04:00:00Z').status,'due_for_checks');
});
test('historical events, existing holds and unknown inputs never become due automatically', () => {
  const when=Date.parse('2030-02-01T00:00:00Z');
  for (const [changes, policy, blocker] of [
    [{}, {...futurePolicy,effectiveAt:'2030-01-05T02:30:00Z'}, 'historical_event_requires_review'],
    [{payoutStatus:'on_hold'}, futurePolicy, 'event_not_pending'],
    [{status:'canceled'}, futurePolicy, 'event_not_pending'],
    [{disputesClear:false}, futurePolicy, 'dispute_review_required'],
    [{endAt:null}, futurePolicy, 'event_times_not_verified'],
    [{endAt:'2030-01-04T22:00:00'}, futurePolicy, 'event_times_not_verified'],
    [{timeZone:'America/Los_Angeles'}, futurePolicy, 'event_time_zone_not_verified'],
    [{}, {...futurePolicy,calendar:{...calendar,through:'2030-01-05'}}, 'reviewed_calendar_coverage_required'],
  ]) {
    const result=evaluateFuturePromoterSchedule({...futureEvent,...changes},policy,when);
    assert.equal(result.status,'blocked');
    assert.equal(result.blocker,blocker);
    assert.equal(result.executionAllowed,false);
  }
});

import { assessOrganizerPayoutOrder } from './payments/promoter-preflight.mjs';
const settledPromoter = { eventId:1001, promoterId:'first', netCents:1000, accountingCurrency:'usd',
  status:'verified_transfer', settledCents:1000, settledCurrency:'usd', verifiedReceiptId:'first-receipt' };
const otherPromoter = { ...settledPromoter, promoterId:'second', status:'verified_external_payment', verifiedReceiptId:'second-receipt' };
const orderSnapshot = { eventId:1001, payoutStatus:'pending', disputesClear:true,
  completePromoterLedger:true, observedAt:new Date(now).toISOString(), obligations:[settledPromoter,otherPromoter] };
test('organizer ordering clears only after all event promoter obligations are verified', () => {
  assert.deepEqual(assessOrganizerPayoutOrder(orderSnapshot,1001,now),
    { promoterFirstSatisfied:true,executionAllowed:false,blocker:null });
  for (const patch of [{status:'pending'},{status:'awaiting_stripe_setup'},
      {status:'uncertain'},{settledCents:999},{verifiedReceiptId:'first-receipt'},{settledCurrency:'eur'}]) {
    const evidence={...orderSnapshot,obligations:[settledPromoter,{...otherPromoter,...patch}]};
    assert.equal(assessOrganizerPayoutOrder(evidence,1001,now).blocker,'promoter_settlement_unresolved');
  }
});
test('a missing ledger, hold or stale snapshot cannot make organizer money eligible', () => {
  for (const patch of [{completePromoterLedger:false,obligations:[]},{payoutStatus:'on_hold'},
      {disputesClear:false},{observedAt:new Date(now-300_001).toISOString()},{eventId:1002},
      {obligations:[settledPromoter,{...otherPromoter,eventId:1002}]}]) {
    const result=assessOrganizerPayoutOrder({...orderSnapshot,...patch},1001,now);
    assert.equal(result.promoterFirstSatisfied,false);
    assert.equal(result.executionAllowed,false);
  }
});
test('verified absence of a promoter balance does not invent a hold', () => {
  for (const obligations of [[],[{...settledPromoter,netCents:0,status:'verified_no_balance_due'}]]) {
    assert.equal(assessOrganizerPayoutOrder({...orderSnapshot,obligations},1001,now).promoterFirstSatisfied,true);
  }
});
