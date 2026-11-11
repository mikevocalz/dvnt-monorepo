const {test}=require('node:test');const assert=require('node:assert/strict');const ts=require('typescript');const fs=require('node:fs');
const m={exports:{}};new Function('exports',ts.transpileModule(fs.readFileSync(__dirname+'/settlement-readiness.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports);
const {settlementReadinessIssues:issues,watchSettlementReadiness:watch}=m.exports;
const clean=()=>({worker_expected:false,scheduler_visible:true,active_schedules:0,observed_at:'2030-01-10T12:00:00Z',last_completed_at:null,last_error_at:null,oldest_due_at:null,oldest_checkout_outcome_unknown_at:null,failed_bank_deliveries:0,manual_review_count:0,platform_payout_policy_blocked:0,platform_payout_policy_verified:true,platform_payout_policy_checked_at:'2030-01-10T12:00:00Z'});
test('disabled by design stays quiet even without a first success or schedule',()=>assert.deepEqual(issues(clean()),[]));
test('enabled worker missing schedule and never successful alerts even with no due work',()=>assert.deepEqual(issues({...clean(),worker_expected:true}),['scheduler_missing','worker_never_completed']));
test('unknown inventory, duplicate schedules and failed runs stay distinct',()=>{
 assert.deepEqual(issues({...clean(),worker_expected:true,scheduler_visible:false,active_schedules:null}),['scheduler_unverified','worker_never_completed']);
 assert.deepEqual(issues({...clean(),worker_expected:true,active_schedules:2,last_completed_at:'2030-01-10T10:00:00Z',last_error_at:'2030-01-10T11:00:00Z'}),['scheduler_duplicate','worker_failed','worker_stale']);
});
test('dispute recovery needs review even while workers are intentionally disabled',()=>assert.deepEqual(issues({...clean(),manual_review_count:1}),['manual_recovery_review']));
test('invalid snapshots fail closed',()=>{for(const s of [null,{}, {...clean(),manual_review_count:-1},{...clean(),last_completed_at:'bad'}])assert.throws(()=>issues(s));});
test('unavailable snapshot is clamped and sanitized without invoking financial actions',async()=>{
 const calls=[],captures=[];const db={async rpc(name,args){calls.push([name,args]);return name==='settlement_health'?{data:null,error:{message:'private'}}:{data:true};}};
 assert.equal(await watch(db,async e=>captures.push(e.message)),false);assert.deepEqual(calls.map(c=>c[0]),['settlement_health','claim_settlement_readiness_alert']);assert.doesNotMatch(captures[0],/private/);
});

test('provider sweep configuration drift alerts without changing settings',()=>assert.deepEqual(issues({...clean(),platform_payout_policy_blocked:1}),['platform_payout_policy_unverified']));

test('enabled empty worker must keep platform settings observation fresh',()=>assert.deepEqual(issues({...clean(),worker_expected:true,active_schedules:1,last_completed_at:'2030-01-10T12:00:00Z',platform_payout_policy_verified:false}),['platform_payout_policy_unverified']));

test('healthy worker still alerts overdue blocked settlements and failed bank delivery',()=>assert.deepEqual(issues({...clean(),worker_expected:true,active_schedules:1,last_completed_at:'2030-01-10T12:00:00Z',oldest_due_at:'2030-01-10T10:00:00Z',funding_blocked:1,onboarding_or_account_blocked:1,source_audit_blocked:1,uncertain_transfers:1,failed_bank_deliveries:1}),['bank_delivery_failed','due_settlement_attention']));
test('overdue obligations stay visible after kill switches; future/recent and normal bank pending do not page',()=>{
 assert.deepEqual(issues({...clean(),oldest_due_at:'2030-01-10T10:00:00Z'}),['due_settlement_attention']);
 for(const at of [null,'2030-01-11T12:00:00Z','2030-01-10T11:59:00Z'])assert.deepEqual(issues({...clean(),oldest_due_at:at,unverified_bank_deliveries:1}),[]);
});

test('unknown checkout outcomes alert distinctly with healthy or paused workers after observation tolerance',()=>{
 for(const worker of [{},{worker_expected:true,active_schedules:1,last_completed_at:'2030-01-10T12:00:00Z'}]){
  assert.deepEqual(issues({...clean(),...worker,oldest_checkout_outcome_unknown_at:'2030-01-10T10:00:00Z'}),['checkout_outcome_unknown']);
  for(const at of [null,'2030-01-10T11:59:00Z','2030-01-11T12:00:00Z'])assert.deepEqual(issues({...clean(),...worker,oldest_checkout_outcome_unknown_at:at}),[]);
 }
 for(const at of [undefined,'bad',12])assert.throws(()=>issues({...clean(),oldest_checkout_outcome_unknown_at:at}));
});
