const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const promoter='00000000-0000-4000-8000-000000000002';
const binding='00000000-0000-4000-8000-000000000003';
const order='00000000-0000-4000-8000-000000000011';
const ledger='00000000-0000-4000-8000-000000000021';
const unknown='00000000-0000-4000-8000-000000000099';
async function rpc(db,name,args={}){const keys=Object.keys(args);const r=await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args));return r.rows[0].v;}
async function fixture({enrolled=false}={}){
 const db=new PGlite();
 for(const p of ['scripts/fixtures/settlement/schema.sql','scripts/fixtures/settlement/external-schema.sql','docs/payments/drafts/settlement-ledger.sql','docs/payments/drafts/settlement-runtime.sql','docs/payments/drafts/settlement-release-policy.sql','scripts/fixtures/settlement/approved-policy.sql','docs/payments/drafts/settlement-recovery.sql','docs/payments/drafts/settlement-outflows.sql','docs/payments/drafts/settlement-observability.sql'])await db.exec(fs.readFileSync(path.join(root,p),'utf8'));
 await db.exec(`UPDATE event_promoters SET user_id='fixture-promoter',stripe_account_id='acct_promoter';
 UPDATE dvnt_settlement.controls SET checkout_enabled=true,transfers_enabled=true,release_delay_seconds=86400; INSERT INTO dvnt_settlement.currency_reserves VALUES('usd',0,'synthetic reviewed fixture');`);
 let oid=order;
 if(enrolled){
  const snapshot={rail:'create-payment-intent',selection:{ticket_type_id:'fixture-tier'},order:{user_id:'fixture-buyer',event_id:1,quantity:1,currency:'usd',total_cents:11000,subtotal_cents:10000,organizer_fee_cents:500,platform_fee_cents:1000,dvnt_total_fee_cents:1000,promoter_code:'FIXTURE',promoter_commission_amount_cents:1000,promoter_commission_bps:1000,promoter_customer_discount_bps:0}};
  oid=(await rpc(db,'prepare_settlement_checkout',{p_snapshot:snapshot,p_request_key:'external-fixture-request'})).order_id;
  await rpc(db,'claim_settlement_checkout',{p_order_id:oid,p_params:{amount:'11000'}});
  await rpc(db,'finalize_settlement_checkout',{p_order_id:oid,p_payment_intent_id:'pi_fixture',p_checkout_session_id:null});
  await rpc(db,'settlement_verify_source',{p_order_id:oid,p_charge:'ch_fixture',p_pi:'pi_fixture',p_currency:'usd',p_gross:11000,p_tax:0});
 } else await db.exec(`INSERT INTO orders(id,event_id,status,type,charge_model,currency,total_cents,subtotal_cents,organizer_fee_cents,promoter_id,promoter_code,promoter_commission_amount_cents,stripe_payment_intent_id) VALUES('${oid}',1,'paid','event_ticket','destination_charge','usd',11000,10000,500,'${promoter}','FIXTURE',1000,'pi_fixture');
 INSERT INTO promoter_attributions(order_id,promoter_id) VALUES('${oid}','${promoter}');`);
 // Quarantine precedes installing claim interlocks, like a drained deployment.
 await db.exec(`UPDATE events SET payout_status='on_hold',payout_release_at=NULL;
 INSERT INTO promoter_ledger_entries(id,promoter_id,event_id,order_id,entry_type,amount_cents) VALUES('${ledger}','${promoter}',1,'${oid}','earning',1000);`);
 await db.exec(fs.readFileSync(path.join(root,'docs/payments/drafts/settlement-external.sql'),'utf8'));
 await db.exec(`INSERT INTO dvnt_settlement.external_operators VALUES('fixture-operator',true);
 INSERT INTO dvnt_settlement.external_recipients(id,promoter_id,provider,beneficiary_reference,verified_by,recipient_user_id) VALUES('${binding}','${promoter}','fixture_provider','fixture-beneficiary','fixture-operator','fixture-promoter');`);
 return {db,order:oid};
}
function args(overrides={}){return {p_actor:'fixture-operator',p_request_key:'00000000-0000-4000-8000-000000000031',p_event_id:1,p_promoter_id:promoter,p_recipient_binding_id:binding,p_ledger_entry_ids:[ledger],p_amount_cents:1000,p_currency:'usd',p_provider:'fixture_provider',p_transaction_reference:'fixture-transaction',p_receipt_sha256:'a'.repeat(64),p_receipt_reference:'fixture-vault/receipt/version-1',p_evidence_status:'completed',p_paid_at:'2026-01-01T00:00:00Z',p_receipt_beneficiary_reference:'fixture-beneficiary',p_attestation:{independently_checked_completed_final:true,receipt_retained:true,recipient_and_details_match:true},...overrides};}
const record=(db,overrides={})=>rpc(db,'settlement_record_external_promoter_payment',args(overrides));
const count=async(db,table)=>(await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
async function unchanged(db){assert.equal(await count(db,'dvnt_settlement.external_promoter_payments'),0);assert.equal(await count(db,'dvnt_settlement.external_event_exclusions'),0);assert.equal((await db.query('select paid_out_at from promoter_ledger_entries')).rows[0].paid_out_at,null);}

test('exact receipt-backed recording is atomic, idempotent, immutable and never fabricates Stripe evidence',async()=>{
 const {db}=await fixture();try{
 const first=await record(db);assert.equal(first.status,'paid_externally');assert.equal(first.replayed,false);
 const repeat=await record(db);assert.equal(repeat.id,first.id);assert.equal(repeat.replayed,true);
 assert.equal(await count(db,'dvnt_settlement.external_promoter_rows'),1);
 const l=(await db.query('select * from promoter_ledger_entries')).rows[0];assert.equal(l.amount_cents,1000);assert.equal(l.payout_status,'paid');assert.equal(l.stripe_transfer_id,null);assert.ok(l.paid_out_at);
 await assert.rejects(record(db,{p_amount_cents:1001}),/replay mismatch/);
 await assert.rejects(record(db,{p_receipt_beneficiary_reference:'wrong'}),/recipient binding/);
 for(const table of ['external_recipients','external_promoter_payments','external_promoter_rows','external_event_exclusions','legacy_execution_claims']){
  if(table==='legacy_execution_claims')continue;
  await assert.rejects(db.exec(`delete from dvnt_settlement.${table}`),/immutable/);
 }
 await assert.rejects(db.exec('update promoter_ledger_entries set paid_out_at=NULL'),/immutable/);
 await assert.rejects(db.exec("update promoter_ledger_entries set stripe_transfer_id='tr_fake'"),/immutable/);
 await assert.rejects(db.exec('delete from promoter_ledger_entries'),/immutable/);
 assert.equal((await rpc(db,'settlement_balance_checkpoint')).epoch,1);
 }finally{await db.close();}
});

test('count/sum/recipient/currency mismatch, unpaid/reversed orders and partial/duplicate scopes all roll back',async()=>{
 const {db}=await fixture();try{
 for(const change of [{p_amount_cents:999},{p_currency:'eur'},{p_promoter_id:unknown},{p_ledger_entry_ids:[ledger,unknown]},{p_ledger_entry_ids:[ledger,ledger]},{p_ledger_entry_ids:[]},{p_ledger_entry_ids:[null]},{p_recipient_binding_id:unknown},{p_receipt_beneficiary_reference:'different-beneficiary'}]){
  await assert.rejects(record(db,change));await unchanged(db);
 }
 for(const status of ['refunded','partially_refunded','disputed','created']){await db.query('update orders set status=$1',[status]);await assert.rejects(record(db),/eligibility mismatch/);await unchanged(db);}
 await db.exec("update orders set status='paid'; insert into promoter_ledger_entries(promoter_id,event_id,order_id,entry_type,amount_cents) select promoter_id,event_id,order_id,'reversal',-1 from promoter_ledger_entries limit 1");
 await assert.rejects(record(db),/eligibility mismatch/);await unchanged(db);
 }finally{await db.close();}
});

test('pending/missing/failed/unverified receipts, future paid times and disabled actors are never paid',async()=>{
 const {db}=await fixture();try{
 for(const change of [{p_evidence_status:'pending'},{p_evidence_status:'failed'},{p_evidence_status:null},{p_receipt_sha256:null},{p_receipt_reference:''},{p_receipt_reference:'https://public.example.invalid/receipt'},{p_receipt_reference:'fixture-vault/../secret'},{p_receipt_reference:'name@example.invalid'},{p_transaction_reference:''},{p_attestation:null},{p_attestation:{}},{p_paid_at:'2099-01-01T00:00:00Z'},{p_provider:'stripe'},{p_actor:'fixture-host'}]){
  await assert.rejects(record(db,change));await unchanged(db);
 }
 await db.exec('update dvnt_settlement.external_operators set enabled=false');await assert.rejects(record(db),/not authorized/);
 }finally{await db.close();}
});

test('receipt digest and provider transaction cannot be reused for another obligation',async()=>{
 const {db}=await fixture();try{
 await record(db);
 const secondOrder='00000000-0000-4000-8000-000000000012',secondLedger='00000000-0000-4000-8000-000000000022';
 await db.exec(`INSERT INTO orders(id,event_id,status,currency,type) VALUES('${secondOrder}',1,'paid','usd','event_ticket');INSERT INTO promoter_attributions(order_id,promoter_id) VALUES('${secondOrder}','${promoter}');INSERT INTO promoter_ledger_entries(id,promoter_id,event_id,order_id,entry_type,amount_cents) VALUES('${secondLedger}','${promoter}',1,'${secondOrder}','earning',1000);`);
 for(const change of [{p_receipt_sha256:'b'.repeat(64)},{p_transaction_reference:'fixture-other-transaction'}]){
  await assert.rejects(record(db,{p_request_key:unknown,p_ledger_entry_ids:[secondLedger],...change}),/unique/);
  assert.equal(await count(db,'dvnt_settlement.external_promoter_payments'),1);
  assert.equal((await db.query('select paid_out_at from promoter_ledger_entries where id=$1',[secondLedger])).rows[0].paid_out_at,null);
 }
 }finally{await db.close();}
});

test('promoter/host clients cannot record, inspect private receipts or mutate service-protected evidence',async()=>{
 const {db}=await fixture();try{
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);await assert.rejects(record(db),/permission/);
  await assert.rejects(rpc(db,'settlement_external_operator_allowed',{p_actor:'fixture-operator'}),/permission/);
  await assert.rejects(db.exec('select * from dvnt_settlement.external_promoter_payments'),/permission/);await db.exec('reset role');
 }
 await db.exec('set role service_role');await record(db);
 for(const sql of ['select * from dvnt_settlement.external_promoter_payments','delete from dvnt_settlement.external_event_exclusions',"insert into dvnt_settlement.external_operators values('rogue',true)"])
  await assert.rejects(db.exec(sql),/permission/);
 await db.exec('reset role');
 }finally{await db.close();}
});

test('legacy organizer exclusion survives final dispute auto-clear, release dates and owner exception flags',async()=>{
 const {db}=await fixture();try{
 await record(db);await db.exec("update events set payout_status='pending',payout_release_at='2020-01-01';update dvnt_settlement.controls set owner_host_ids=ARRAY['fixture-host'];insert into dvnt_settlement.event_stops values(1,'dispute_only')");
 assert.equal((await rpc(db,'settlement_legacy_event_eligible',{p_event_id:1})).eligible,false);
 await assert.rejects(db.query('update events set payout_status=$1 where id=1',['processing']),/excludes legacy/);
 await assert.rejects(rpc(db,'settlement_claim_legacy_event',{p_event_id:1}),/excluded/);
 await db.exec("update events set payout_status='on_hold';update events set payout_status='pending'");
 await assert.rejects(db.exec("insert into payouts(event_id,status) values(1,'pending')"),/excludes legacy/);
 assert.equal(await count(db,'payouts'),0);
 }finally{await db.close();}
});

test('prior legacy claim survives resetting event and blocks external recording',async()=>{
 const {db}=await fixture();try{
 await db.exec("update events set payout_status='pending';update events set payout_status='processing';update events set payout_status='on_hold',payout_release_at=NULL");
 await assert.rejects(record(db),/execution requires reconciliation/);await unchanged(db);
 await assert.rejects(db.exec('delete from dvnt_settlement.legacy_execution_claims'),/immutable/);
 }finally{await db.close();}
});

test('external-first blocks both private/public Stripe reservation and reports only manually verified external status',async()=>{
 const {db,order:oid}=await fixture({enrolled:true});try{
 await record(db);await db.exec("update events set payout_status='pending'");
 const a=(await db.query("select id from dvnt_settlement.allocations where role='promoter'")).rows[0];
 await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:a.id,p_destination:'acct_promoter',p_available:100000,p_balance_epoch:(await rpc(db,'settlement_balance_checkpoint')).epoch}),/already settled externally/);
 await assert.rejects(db.query('select dvnt_settlement.reserve($1,$2)',[a.id,'acct_promoter']),/already settled externally/);
 assert.equal((await db.query('select dvnt_settlement.promoter_obligation_satisfied($1) v',[a.id])).rows[0].v,true);
 const summary=await rpc(db,'settlement_actor_summary',{p_actor:'fixture-promoter',p_event_id:1});
 assert.equal(summary.rows.length,1);assert.equal(summary.rows[0].stage,'paid_externally');assert.equal(summary.rows[0].amount_cents,1000);
 assert.deepEqual((await rpc(db,'settlement_actor_summary',{p_actor:'fixture-other',p_event_id:1})).rows,[]);
 await db.query("update orders set status='disputed' where id=$1",[oid]);
 assert.equal((await db.query('select dvnt_settlement.promoter_obligation_satisfied($1) v',[a.id])).rows[0].v,false);
 assert.equal((await rpc(db,'settlement_actor_summary',{p_actor:'fixture-promoter',p_event_id:1})).rows[0].stage,'external_needs_review');
 }finally{await db.close();}
});

test('reserved/uncertain/transferred Stripe-first attempts exclude external stamping and preserve review holds',async()=>{
 const {db}=await fixture({enrolled:true});try{
 await db.exec("update events set payout_status='pending'");const a=(await db.query("select id from dvnt_settlement.allocations where role='promoter'")).rows[0];
 await rpc(db,'settlement_reserve',{p_allocation:a.id,p_destination:'acct_promoter',p_available:100000,p_balance_epoch:(await rpc(db,'settlement_balance_checkpoint')).epoch});
 // Avoid creating a legacy event claim: fixture can start quarantined via disabled.
 await db.exec("update events set payout_status='disabled';update events set payout_status='on_hold',payout_release_at=NULL");
 await assert.rejects(record(db),/eligibility mismatch/);await unchanged(db);
 await rpc(db,'settlement_uncertain',{p_allocation:a.id,p_error:'uncertain'});await assert.rejects(record(db),/eligibility mismatch/);
 await rpc(db,'settlement_reconcile_transfer',{p_allocation:a.id,p_transfer:'tr_fixture',p_destination:'acct_promoter',p_charge:'ch_fixture',p_currency:'usd',p_amount:1000});await assert.rejects(record(db),/eligibility mismatch/);
 }finally{await db.close();}
});

test('failure while stamping rolls back evidence, exclusion, counters and ledger together',async()=>{
 const {db}=await fixture();try{
 await db.exec("create function public.fixture_fail_stamp() returns trigger language plpgsql as $$begin raise exception 'fixture failure';end$$;create trigger fixture_fail before update on promoter_ledger_entries for each row execute function public.fixture_fail_stamp()");
 await assert.rejects(record(db),/fixture failure/);await unchanged(db);
 assert.equal((await rpc(db,'settlement_balance_checkpoint')).epoch,0);
 }finally{await db.close();}
});
module.exports={fixture,rpc,args,record};

test('later legacy reversal creates immutable typed manual recovery without fake Stripe reversal or lost earnings',async()=>{
 const {db}=await fixture();try{
 await record(db);
 assert.equal((await rpc(db,'settlement_external_recovery_health')).external_recovery_review_required,0);
 await db.exec("insert into promoter_ledger_entries(promoter_id,event_id,order_id,entry_type,amount_cents) select promoter_id,event_id,order_id,'reversal',-1000 from promoter_ledger_entries limit 1");
 const queue=await rpc(db,'settlement_external_recovery_candidates',{p_limit:100});assert.equal(queue.length,1);
 assert.equal(queue[0].reason,'ledger_reversal');assert.equal(queue[0].action,'manual_external_payment_recovery_review');
 assert.equal(queue[0].amount_cents,1000);assert.equal(queue[0].currency,'usd');
 assert.doesNotMatch(JSON.stringify(queue),/transaction_reference|receipt|beneficiary|stripe_transfer/);
 assert.equal((await rpc(db,'settlement_external_recovery_health')).external_recovery_review_required,1);
 assert.equal((await rpc(db,'settlement_actor_summary',{p_actor:'fixture-promoter',p_event_id:1})).rows[0].stage,'external_needs_review');
 await assert.rejects(db.exec('delete from dvnt_settlement.external_recovery_reviews'),/immutable/);
 await assert.rejects(db.exec("update orders set event_id=2"),/immutable/);
 await assert.rejects(db.exec("update promoter_ledger_entries set external_settlement_id=NULL where entry_type='earning'"),/immutable/);
 assert.equal((await db.query("select amount_cents from promoter_ledger_entries where entry_type='earning'")).rows[0].amount_cents,1000);
 }finally{await db.close();}
});

test('multi-row receipt stamps exactly its complete sorted scope and replays independent of input ordering',async()=>{
 const {db}=await fixture();try{
 const secondOrder='00000000-0000-4000-8000-000000000012',secondLedger='00000000-0000-4000-8000-000000000022';
 await db.exec(`INSERT INTO orders(id,event_id,status,currency,type) VALUES('${secondOrder}',1,'paid','usd','event_ticket');INSERT INTO promoter_attributions(order_id,promoter_id) VALUES('${secondOrder}','${promoter}');INSERT INTO promoter_ledger_entries(id,promoter_id,event_id,order_id,entry_type,amount_cents) VALUES('${secondLedger}','${promoter}',1,'${secondOrder}','earning',400);`);
 await assert.rejects(record(db,{p_ledger_entry_ids:[secondLedger,ledger],p_amount_cents:1399}),/amount/);await unchanged(db);
 const first=await record(db,{p_ledger_entry_ids:[secondLedger,ledger],p_amount_cents:1400});
 const replay=await record(db,{p_ledger_entry_ids:[ledger,secondLedger],p_amount_cents:1400});
 assert.equal(first.id,replay.id);assert.equal(replay.replayed,true);
 const rows=(await db.query('select amount_cents,external_settlement_id from promoter_ledger_entries')).rows;
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.external_settlement_id===first.id));assert.equal(rows.reduce((s,r)=>s+r.amount_cents,0),1400);
 }finally{await db.close();}
});

test('receipt binding and frozen checkout identities reject promoter reassignment, including pre-enrollment',async()=>{
 for(const preEnrollment of [false,true]){
  const {db}=await fixture({enrolled:true});try{
   if(preEnrollment){await db.exec('alter table dvnt_settlement.allocations disable trigger immutable_allocations;delete from dvnt_settlement.deliveries;delete from dvnt_settlement.allocations;delete from dvnt_settlement.orders;alter table dvnt_settlement.allocations enable trigger immutable_allocations;');}
   await db.exec("update event_promoters set user_id='fixture-reassigned-user'");
   await assert.rejects(record(db),/recipient binding/);await unchanged(db);
   // Even a new valid binding for the reassigned user cannot settle an old user's frozen obligation.
   await db.exec(`insert into dvnt_settlement.external_recipients(id,promoter_id,provider,beneficiary_reference,verified_by,recipient_user_id) values('${unknown}','${promoter}','fixture_provider','fixture-new-beneficiary','fixture-operator','fixture-reassigned-user')`);
   await assert.rejects(record(db,{p_recipient_binding_id:unknown,p_receipt_beneficiary_reference:'fixture-new-beneficiary'}),/eligibility mismatch/);await unchanged(db);
  }finally{await db.close();}
 }
});

test('a name-only binding cannot be silently reassigned, and recorded ownership never follows later account links',async()=>{
 const {db}=await fixture();try{
 await db.exec(`update event_promoters set user_id=NULL;insert into dvnt_settlement.external_recipients(id,promoter_id,provider,beneficiary_reference,verified_by) values('${unknown}','${promoter}','fixture_provider','fixture-name-only','fixture-operator')`);
 await record(db,{p_recipient_binding_id:unknown,p_receipt_beneficiary_reference:'fixture-name-only'});
 await db.exec("update event_promoters set user_id='fixture-later-user'");
 assert.deepEqual((await rpc(db,'settlement_actor_summary',{p_actor:'fixture-later-user',p_event_id:1})).rows,[]);
 assert.equal((await db.query('select recipient_user_id from dvnt_settlement.external_promoter_rows')).rows[0].recipient_user_id,null);
 }finally{await db.close();}
});

test('external receipts on pre-enrollment orders surface refund/dispute/manual holds in durable manual recovery queue',async()=>{
 for(const reason of ['refund','dispute','manual']){
  const {db,order:oid}=await fixture({enrolled:true});try{
   await db.exec('alter table dvnt_settlement.allocations disable trigger immutable_allocations;delete from dvnt_settlement.deliveries;delete from dvnt_settlement.allocations;delete from dvnt_settlement.orders;alter table dvnt_settlement.allocations enable trigger immutable_allocations;');
   await record(db);
   await rpc(db,'settlement_hold',{p_order_id:oid,p_event_id:'fixture-preenrollment-'+reason,p_reason:reason});
   assert.equal((await rpc(db,'settlement_external_recovery_health')).external_recovery_review_required,1);
   const queue=await rpc(db,'settlement_external_recovery_candidates',{p_limit:100});assert.equal(queue.length,1);assert.equal(queue[0].reason,reason);
   assert.equal((await rpc(db,'settlement_actor_summary',{p_actor:'fixture-promoter',p_event_id:1})).rows[0].stage,'external_needs_review');
   await db.exec('update dvnt_settlement.checkouts set last_error=NULL');
   assert.equal((await rpc(db,'settlement_external_recovery_health')).external_recovery_review_required,1);
  }finally{await db.close();}
 }
});

test('pre-enrollment ledger commission must exactly match immutable checkout economics',async()=>{
 const {db}=await fixture({enrolled:true});try{
 await db.exec('alter table dvnt_settlement.allocations disable trigger immutable_allocations;delete from dvnt_settlement.deliveries;delete from dvnt_settlement.allocations;delete from dvnt_settlement.orders;alter table dvnt_settlement.allocations enable trigger immutable_allocations;');
 await db.exec('update promoter_ledger_entries set amount_cents=2000');
 await assert.rejects(record(db,{p_amount_cents:2000}),/eligibility mismatch/);await unchanged(db);
 }finally{await db.close();}
});
