const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {resolve}=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {sourceSchemaSql}=require('./fixtures/settlement/replacement-source-schema.cjs');
const root=resolve(__dirname,'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const candidate=read('docs/payments/drafts/settlement-adoption.generated.sql');
const receiptFile='apps/mobile/supabase/migrations/20261113142940_external_receipt_guard.sql';
const ordersFixture='scripts/fixtures/settlement/schema.sql';
const receiptOrder='00000000-0000-4000-8000-000000000011';
async function fixture({prior=true}={}){
 const db=new PGlite();
 await db.exec(read(ordersFixture));await db.exec(read('scripts/fixtures/settlement/external-schema.sql'));await db.exec(sourceSchemaSql());
 await db.exec(`ALTER TABLE events ADD CONSTRAINT events_payout_status_check CHECK(payout_status IN ('pending','on_hold','released','disabled'));
 CREATE TABLE IF NOT EXISTS public.session(id text PRIMARY KEY,"userId" text NOT NULL,"expiresAt" timestamptz NOT NULL,"updatedAt" timestamptz NOT NULL)`);
 if(prior)await db.exec(read(receiptFile));
 return db;
}
async function rpc(db,name,args={}){
 return (await db.query(`select public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args))).rows[0].v;
}
async function seedReceipt(db){
 await db.exec(read('scripts/fixtures/external-receipt-guard/seed.sql'));
 const result=await rpc(db,'settlement_record_external_promoter_payment_session',{
  p_session_id:'fixture-session-row',p_actor:'fixture-operator',p_request_key:'00000000-0000-4000-8000-000000000031',p_event_id:1,
  p_promoter_id:'00000000-0000-4000-8000-000000000002',p_recipient_binding_id:'00000000-0000-4000-8000-000000000003',
  p_ledger_entry_ids:'{00000000-0000-4000-8000-000000000021}',p_amount_cents:1000,p_currency:'usd',p_provider:'fixture_provider',
  p_transaction_reference:'fixture-adoption-receipt',p_receipt_sha256:'a'.repeat(64),p_receipt_reference:'fixture-vault/receipt/version-1',
  p_evidence_status:'completed',p_paid_at:'2025-01-01T00:00:00Z',p_receipt_beneficiary_reference:'fixture-beneficiary',
  p_attestation:{independently_checked_completed_final:true,receipt_retained:true,recipient_and_details_match:true},
 });
 assert.equal(result.recorded,true);
}
const snapshot=async db=>(await db.query(`select jsonb_build_object(
 'receipt',(select jsonb_agg(to_jsonb(r) order by id) from dvnt_settlement.external_promoter_payments r),
 'linked',(select jsonb_agg(to_jsonb(r) order by id) from public.promoter_ledger_entries r),
 'reports',(select jsonb_agg(to_jsonb(r) order by event_id,promoter_id) from dvnt_settlement.external_event_quarantines r),
 'reviews',(select jsonb_agg(to_jsonb(r) order by id) from dvnt_settlement.external_event_reviews r),
 'exclusions',(select jsonb_agg(to_jsonb(r) order by event_id) from dvnt_settlement.external_event_exclusions r),
 'claims',(select jsonb_agg(to_jsonb(r) order by event_id) from dvnt_settlement.legacy_execution_claims r),
 'functions',(select jsonb_agg(jsonb_build_array(pg_get_functiondef(oid),proacl::text) order by proname)
   from pg_proc where pronamespace='public'::regnamespace and proname in
   ('settlement_claim_legacy_event','settlement_record_external_promoter_payment_session',
   'settlement_report_external_payment_session','settlement_external_actor_status_session'))
 ) v`)).rows[0].v;

test('adoption preserves real seeded receipt, quarantine, ledger, claim and session contracts; all execution stays off',async()=>{
 const db=await fixture();try{
  await seedReceipt(db);
  await db.exec(`INSERT INTO events(id,payout_status) VALUES(2,'pending');
   INSERT INTO dvnt_settlement.legacy_execution_claims(event_id) VALUES(2);
   UPDATE dvnt_settlement.external_recording_controls SET enabled=false,reporting_enabled=false`);
  const before=await snapshot(db);
  await db.exec(candidate);
  assert.deepEqual(await snapshot(db),before);
  const h=await rpc(db,'settlement_health');assert.equal(h.transfers_enabled,false);assert.equal(h.checkout_enabled,false);assert.equal(h.recovery_enabled,false);
  assert.equal((await rpc(db,'settlement_legacy_event_eligible',{p_event_id:1})).eligible,false);
  assert.equal((await rpc(db,'settlement_legacy_event_eligible',{p_event_id:2})).eligible,false);
  await assert.rejects(db.exec("insert into dvnt_settlement.release_policies values(1,'end_plus_five_business_days','UTC','test receipt policy')"),/manual reconciliation/);
  await db.exec(`update public.orders set status='disputed' where id='${receiptOrder}'`);
  assert.ok((await rpc(db,'settlement_external_recovery_candidates')).some(r=>r.order_id===receiptOrder));
  const access=(await db.query(`select
   has_table_privilege('service_role','dvnt_settlement.external_promoter_payments','select') as receipts,
   has_function_privilege('service_role','public.settlement_external_actor_status(text,integer)','execute') as core_status,
   has_function_privilege('service_role','public.settlement_external_actor_status_session(text,text,integer)','execute') as session_status`)).rows[0];
  assert.deepEqual(access,{receipts:false,core_status:false,session_status:true});
  await db.exec('set role service_role');
  await assert.rejects(rpc(db,'settlement_external_actor_status_session',{p_actor:'fixture-operator',p_session_id:'missing',p_event_id:1}),/valid actor session/);
  await rpc(db,'settlement_external_actor_status_session',{p_actor:'fixture-operator',p_session_id:'fixture-session-row',p_event_id:1});
 }finally{await db.close();}
});

test('an unresolved external report remains fenced and is not promoted into a verified receipt',async()=>{
 const db=await fixture();try{
  await db.exec(read('scripts/fixtures/external-receipt-guard/seed.sql'));
  await db.exec('update dvnt_settlement.external_recording_controls set enabled=false,reporting_enabled=false');
  const before=await snapshot(db);await db.exec(candidate);
  assert.deepEqual(await snapshot(db),before);
  assert.equal(before.receipt,null);assert.equal(before.linked[0].paid_out_at,null);
  const status=await rpc(db,'settlement_external_actor_status',{p_actor:'fixture-promoter',p_event_id:1});
  assert.equal(status.reported_pending_review,true);assert.deepEqual(status.payments,[]);
  assert.equal((await rpc(db,'settlement_legacy_event_eligible',{p_event_id:1})).eligible,false);
  await assert.rejects(db.exec("insert into dvnt_settlement.release_policies values(1,'end_plus_five_business_days','UTC','test report quarantine')"),/manual reconciliation/);
 }finally{await db.close();}
});

test('adoption rejects enabled receipt recording and partial schema atomically',async()=>{
 for(const mode of ['missing','enabled','reporting','existing']){
  const db=await fixture({prior:mode!=='missing'});try{
   if(mode==='enabled'||mode==='reporting')await db.exec('update dvnt_settlement.external_recording_controls set '+(mode==='enabled'?'enabled':'reporting_enabled')+'=true');
   if(mode==='existing')await db.exec('create table dvnt_settlement.controls (fixture_marker int); insert into dvnt_settlement.controls values(7)');
   await assert.rejects(db.exec(candidate),mode==='missing'?/receipt adoption contract missing/:mode==='existing'?/partial or existing settlement runtime/:/must already be off/);
   await db.exec('rollback');
   assert.equal((await db.query("select to_regclass('dvnt_settlement.checkouts') v")).rows[0].v,null);
   if(mode==='existing')assert.equal((await db.query('select fixture_marker v from dvnt_settlement.controls')).rows[0].v,7);
  }finally{await db.close();}
 }
});

test('unfenced events keep legacy checkout; runtime cutover blocks legacy claim and payout writes before execution',async()=>{
 const db=await fixture();try{
  await db.exec(candidate);
  assert.equal((await rpc(db,'settlement_checkout_route',{p_event_id:1})).charge_model,'destination_charge');
  assert.equal((await rpc(db,'settlement_legacy_event_eligible',{p_event_id:1})).eligible,true);
  await assert.rejects(rpc(db,'settlement_claim_legacy_event',{p_event_id:1}),/events_payout_status_check/);
  await db.exec("insert into dvnt_settlement.release_policies values(1,'end_plus_five_business_days','UTC','test runtime policy')");
  assert.equal((await rpc(db,'settlement_legacy_event_eligible',{p_event_id:1})).eligible,false);
  await assert.rejects(rpc(db,'settlement_claim_legacy_event',{p_event_id:1}),/runtime cutover excludes/);
  await assert.rejects(db.exec("insert into public.payouts(event_id,status) values(1,'paid')"),/runtime cutover excludes/);
  assert.equal((await db.query('select count(*)::int v from dvnt_settlement.legacy_execution_claims')).rows[0].v,0);
 }finally{await db.close();}
});

test('candidate stays outside migrations and cannot schedule or enable payouts',()=>{
 assert.ok(!readdirSync(resolve(root,'apps/mobile/supabase/migrations')).some(p=>p.includes('settlement_adoption')));
 assert.doesNotMatch(candidate,/cron\.(?:schedule|unschedule)\s*\(|net\.http_|UPDATE dvnt_settlement\.controls SET[^;]*enabled\s*=\s*true/i);
});
