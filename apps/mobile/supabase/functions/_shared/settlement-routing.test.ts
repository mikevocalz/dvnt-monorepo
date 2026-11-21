import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseChargeModel, chargeRoutingFields, type SeparateChargeGate } from './settlement-routing.ts';
const ready: SeparateChargeGate = {
 enabled:true, rolloutApproved:true,durableOrderId:'fixture-order',allocationSnapshotPersisted:true,
 refundDisputeInterlockReady:true,sourceReconciliationReady:true,
};
test('separate model needs every rollout gate; disabled by default',()=>{
 assert.equal(chooseChargeModel({...ready,enabled:false}),'destination_charge');
 for(const key of ['rolloutApproved','allocationSnapshotPersisted','refundDisputeInterlockReady','sourceReconciliationReady'] as const) {
  assert.throws(()=>chooseChargeModel({...ready,[key]:false}),/blocked/);
 }
 assert.throws(()=>chooseChargeModel({...ready,durableOrderId:null}),/blocked/);
 assert.equal(chooseChargeModel(ready),'separate_charges_and_transfers');
});
test('retry never changes routing, even if feature flag changes',()=>{
 assert.equal(chooseChargeModel(ready,'destination_charge',true),'destination_charge');
 assert.throws(()=>chooseChargeModel({...ready,enabled:false},'separate_charges_and_transfers',true),/blocked/);
 assert.throws(()=>chooseChargeModel(ready,null,true),/reconciliation/);
 assert.throws(()=>chooseChargeModel(ready,'future-model' as never,true),/Unknown/);
});
test('separate payment intent and hosted checkout contain no destination or application fee',()=>{
 for(const hosted of [false,true]) {
  const fields=chargeRoutingFields('separate_charges_and_transfers','',300,hosted);
  assert.ok(Object.keys(fields).every(k=>!k.includes('transfer_data')&&!k.includes('application_fee')));
  assert.equal(fields[hosted?'payment_intent_data[metadata][charge_model]':'metadata[charge_model]'],'separate_charges_and_transfers');
 }
});
test('destination financial routing is preserved and metadata is explicit',()=>{
 assert.deepEqual(chargeRoutingFields('destination_charge','acct_fixture',300),{
  'metadata[charge_model]':'destination_charge','transfer_data[destination]':'acct_fixture',application_fee_amount:'300',
 });
 assert.equal(chargeRoutingFields('destination_charge','acct_fixture',300,true)['metadata[charge_model]'],'destination_charge');
 assert.throws(()=>chargeRoutingFields('destination_charge','',300),/destination/);
 for(const cents of [-1,NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1]) {
  assert.throws(()=>chargeRoutingFields('destination_charge','acct_fixture',cents),/fee/);
 }
});
