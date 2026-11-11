import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promoterConnectPresentation as setup, promoterSettlementPresentation as settlement, promoterEventId } from './promoter-payout-status.ts';

test('unknown and failed account checks cannot claim setup complete', () => {
  assert.match(setup(undefined).title, /Checking/);
  assert.match(setup({connected: true, detailsSubmitted: true, payoutsEnabled: true, transfersEnabled: true}, true).title, /unavailable/);
});
test('Stripe requirements distinguish unfinished setup, review, restrictions, and readiness', () => {
  assert.equal(setup({connected:false}).action, 'Connect bank account');
  assert.equal(setup({connected:true}).title, 'Finish payout setup');
  assert.equal(setup({connected:true, detailsSubmitted:true}).title, 'Stripe review in progress');
  assert.equal(setup({connected:true, currentlyDue:['identity']}).title, 'Stripe needs more information');
  assert.equal(setup({connected:true, pastDue:['identity']}).title, 'Stripe needs more information');
  assert.equal(setup({connected:true, disabledReason:'rejected.other'}).title, 'Payouts are restricted');
  assert.equal(setup({connected:true, detailsSubmitted:true, payoutsEnabled:true}).title, 'Stripe review in progress');
  const ready=setup({connected:true, detailsSubmitted:true, payoutsEnabled:true, transfersEnabled:true});
  assert.equal(ready.title,'Payout setup complete');
  assert.match(ready.detail,/does not confirm a bank deposit/);
});
test('settlement and unknown states never describe bank arrival', () => {
  assert.equal(settlement(null).title,'Commission status unavailable');
  assert.equal(settlement({status:'held',hasRecordedTransfer:false}).title,'Awaiting payout review');
  assert.equal(settlement({status:'settled',hasRecordedTransfer:false}).title,'Commissions settled');
  assert.equal(settlement({status:'settled',hasRecordedTransfer:true}).title,'Stripe transfer recorded');
  assert.match(settlement({status:'settled',hasRecordedTransfer:true}).detail,/does not confirm a deposit/);
});
test('event identifiers must be whole positive safe integers', () => {
  for (const raw of ['42oops','42.5','0','-1','',undefined,'9007199254740992']) assert.ok(Number.isNaN(promoterEventId(raw)));
  assert.equal(promoterEventId('42'),42);
  assert.equal(promoterEventId(['42']),42);
});
