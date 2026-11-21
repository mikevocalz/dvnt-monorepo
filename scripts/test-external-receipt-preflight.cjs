'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkEvidence, MAX_BYTES } = require('./check-external-receipt-preflight.cjs');
function fixture() {
  return { schema_version: 1, scope_id: 'synthetic-scope', recipient_binding_id: 'synthetic-recipient',
    receipt: { status: 'completed', independently_verified: true, amount_cents: 125, currency: 'usd', transaction_reference: 'synthetic-reference', sha256: 'a'.repeat(64), immutable_private_copy_verified: true, paid_at: '2026-01-01T12:00:00Z', recipient_binding_id: 'synthetic-recipient' },
    quarantine: { status: 'on_hold', release_at: null },
    review: Object.fromEntries(['recipient_identity_verified','operator_authorized','workers_drained','stripe_destinations_reconciled','unknown_outcomes_absent','legacy_claims_absent','aggregate_payouts_absent','provider_reference_unused'].map(k => [k,true])),
    rows: [{ id: 'synthetic-row', order_id: 'synthetic-order', scope_id: 'synthetic-scope', recipient_binding_id: 'synthetic-recipient', attribution_verified: true, entry_type: 'earning', amount_cents: 125, currency: 'usd', order_status: 'paid', order_type: 'event_ticket', payout_status: 'pending', paid_out_at: null, stripe_transfer_id: null, external_settlement_id: null, has_refund: false, has_dispute: false, has_reversal: false, has_hold: false, has_reservation: false, has_unknown_outcome: false }] };
}
test('complete synthetic evidence passes only offline checklist, never deployment', () => {
  const x=fixture(), before=JSON.stringify(x), result=checkEvidence(x);
  assert.equal(result.evidence_check_passed,true); assert.equal(result.deployment_ready,false);
  assert.equal(result.live_changes_performed,false); assert.equal(JSON.stringify(x),before);
  assert.deepEqual(checkEvidence(x),result); // repeat is pure, not a claimed DB replay test
});
for (const key of Object.keys(fixture().review)) test(`missing review ${key} fails closed`,()=>{const x=fixture();delete x.review[key];assert.equal(checkEvidence(x).evidence_check_passed,false);});
for (const [key,value] of Object.entries({status:'pending',independently_verified:false,amount_cents:100,currency:'eur',transaction_reference:'',sha256:'bad',immutable_private_copy_verified:false,paid_at:'yesterday',recipient_binding_id:'other'})) test(`invalid receipt ${key}`,()=>{const x=fixture();x.receipt[key]=value;assert.equal(checkEvidence(x).evidence_check_passed,false);});
for (const key of ['has_refund','has_dispute','has_reversal','has_hold','has_reservation','has_unknown_outcome']) test(`source ${key} true or missing fails closed`,()=>{for(const value of [true,undefined]){const x=fixture();x.rows[0][key]=value;assert.equal(checkEvidence(x).evidence_check_passed,false);}});
for (const key of ['paid_out_at','stripe_transfer_id','external_settlement_id']) test(`existing or unknown ${key}`,()=>{for(const value of ['present',undefined]){const x=fixture();x.rows[0][key]=value;assert.equal(checkEvidence(x).evidence_check_passed,false);}});
for (const [key,value] of Object.entries({scope_id:'other',recipient_binding_id:'other',attribution_verified:false,entry_type:'reversal',amount_cents:-1,currency:'eur',order_status:'refunded',order_type:'unknown',payout_status:'paid'})) test(`invalid row ${key}`,()=>{const x=fixture();x.rows[0][key]=value;assert.equal(checkEvidence(x).evidence_check_passed,false);});
test('hold clearing or release scheduling blocks checklist',()=>{for(const q of [{status:'pending',release_at:null},{status:'on_hold',release_at:'2026-01-01T00:00:00Z'}]){const x=fixture();x.quarantine=q;assert.equal(checkEvidence(x).evidence_check_passed,false);}});
test('duplicate rows and duplicate order cannot pad amount',()=>{for(const newId of [false,true]){const x=fixture();x.rows.push({...x.rows[0],...(newId?{id:'other-row'}:{})});x.receipt.amount_cents=250;assert.equal(checkEvidence(x).evidence_check_passed,false);}});
test('malformed or absent evidence remains blocked',()=>{for(const x of [null,{},[],{rows:[null]},{schema_version:2}])assert.equal(checkEvidence(x).evidence_check_passed,false);});
test('CLI returns redacted failure and never echoes provider data',()=>{const r=spawnSync(process.execPath,[path.join(__dirname,'check-external-receipt-preflight.cjs')],{input:'{"private":"secret-marker", bad}',encoding:'utf8'});assert.equal(r.status,2);assert.ok(!r.stderr.includes('secret-marker'));});
test('CLI bounded input',()=>{const r=spawnSync(process.execPath,[path.join(__dirname,'check-external-receipt-preflight.cjs')],{input:'x'.repeat(MAX_BYTES+1),encoding:'utf8'});assert.equal(r.status,2);});

test('future or normalized invalid calendar date rejected',()=>{for(const value of ['9999-01-01T00:00:00Z','2026-02-31T12:00:00Z']){const x=fixture();x.receipt.paid_at=value;assert.equal(checkEvidence(x).evidence_check_passed,false);}});
