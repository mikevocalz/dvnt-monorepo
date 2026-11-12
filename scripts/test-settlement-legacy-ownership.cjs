const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');const root=path.resolve(__dirname,'..');
const promoter='00000000-0000-4000-8000-000000000002',order='00000000-0000-4000-8000-000000000011',ledger='00000000-0000-4000-8000-000000000021';
async function fixture(){const db=new PGlite();for(const p of ['scripts/fixtures/settlement/schema.sql','scripts/fixtures/settlement/external-schema.sql','docs/payments/drafts/settlement-ledger.sql','docs/payments/drafts/settlement-runtime.sql','docs/payments/drafts/settlement-release-policy.sql','docs/payments/drafts/settlement-recovery.sql','docs/payments/drafts/settlement-outflows.sql','docs/payments/drafts/settlement-observability.sql','docs/payments/drafts/settlement-external.sql','docs/payments/drafts/settlement-legacy-ownership.sql']){
 if(p.endsWith('settlement-legacy-ownership.sql')) {
  // Install the original deployed policies/grants, not an unrealistically
  // private fixture that would miss the reassignment bypass.
  const original=fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations/20260806100000_promoter_economy.sql'),'utf8');
  await db.exec('ALTER TABLE public.promoter_ledger_entries ENABLE ROW LEVEL SECURITY; ALTER TABLE public.promoter_attributions ENABLE ROW LEVEL SECURITY; GRANT SELECT ON public.events,public.event_promoters TO authenticated; GRANT SELECT ON public.promoter_ledger_entries,public.promoter_attributions TO authenticated,service_role;');
  await db.exec(original.slice(original.indexOf('DROP POLICY IF EXISTS promoter_attributions_select'),original.indexOf('REVOKE ALL ON event_promoters')));
 }
 await db.exec(fs.readFileSync(path.join(root,p),'utf8'));
}
await db.exec(`UPDATE events SET payout_status='on_hold',payout_release_at=NULL; INSERT INTO orders(id,event_id,promoter_id,status,currency,charge_model,total_cents) VALUES('${order}',1,'${promoter}','paid','usd','destination_charge',11000); INSERT INTO promoter_ledger_entries(id,order_id,promoter_id,event_id,amount_cents,entry_type) VALUES('${ledger}','${order}','${promoter}',1,1000,'earning');`);return db;}
async function bind(db,replace='',amount='l.amount_cents',created='l.created_at'){await db.exec(`INSERT INTO dvnt_settlement.legacy_ownership(ledger_entry_id,order_id,promoter_id,event_id,actor_id,amount_cents,currency,ledger_created_at,order_charge_model,order_total_cents,reviewed_by,evidence_reference,evidence_sha256) SELECT l.id,l.order_id,l.promoter_id,l.event_id,'fixture-original',${amount},l.currency,${created},o.charge_model,o.total_cents,'fixture-reviewer','fixture-review/identity/version-1',repeat('a',64) FROM promoter_ledger_entries l JOIN orders o ON o.id=l.order_id ${replace}`);}
async function summary(db,actor='fixture-original'){return (await db.query('select public.settlement_legacy_actor_summary($1,1) v',[actor])).rows[0].v;}
test('reviewed bridge: empty/private ACL, exact immutable identity, separate payment semantics and former ownership',async()=>{const db=await fixture();try{
 assert.deepEqual((await summary(db)).rows,[]);
 for(const role of ['anon','authenticated','service_role']){await db.exec(`set role ${role}`);await assert.rejects(db.exec('select * from dvnt_settlement.legacy_ownership'),/permission/);await assert.rejects(bind(db),/permission/);if(role!=='service_role')await assert.rejects(summary(db),/permission/);else assert.equal((await summary(db)).verified,true);await db.exec('reset role');}
 await bind(db);assert.equal((await summary(db)).rows[0].stage,'legacy_ownership_verified');assert.equal((await summary(db)).rows[0].amount_cents,1000);
 assert.deepEqual((await summary(db,'fixture-reassigned')).rows,[]);await db.exec("update event_promoters set user_id='fixture-reassigned',status='removed'");assert.equal((await summary(db)).rows[0].amount_cents,1000);
 for(const sql of ['delete from dvnt_settlement.legacy_ownership',"update dvnt_settlement.legacy_ownership set actor_id='someone-else'",'truncate dvnt_settlement.legacy_ownership'])await assert.rejects(db.exec(sql),/immutable/);
 const l=(await db.query('select payout_status,paid_out_at,stripe_transfer_id from promoter_ledger_entries')).rows[0];assert.deepEqual(l,{payout_status:'pending',paid_out_at:null,stripe_transfer_id:null});
 }finally{await db.close()}});
test('binding rejects mismatched amount, row generation, currency, source order and new-model rails',async()=>{const db=await fixture();try{
 await assert.rejects(bind(db,'','l.amount_cents+1'),/binding mismatch/);
 await assert.rejects(bind(db,'','l.amount_cents',"l.created_at+interval '1 second'"),/binding mismatch/);
 await db.exec("update orders set currency='eur'");await assert.rejects(bind(db),/binding mismatch/);await db.exec("update orders set currency='usd',charge_model='separate_charges_and_transfers'");await assert.rejects(bind(db));
 }finally{await db.close()}});
test('changed economics/refunds/reversals withhold amounts instead of asserting entitlement',async()=>{const db=await fixture();try{
 await bind(db);for(const sql of ["update orders set status='refunded'","update orders set total_cents=12000","update promoter_ledger_entries set amount_cents=900","update promoter_ledger_entries set created_at=created_at+interval '1 second'"]){await db.exec('begin');await db.exec(sql);const row=(await summary(db)).rows[0];assert.equal(row.stage,'legacy_ownership_needs_review');assert.equal(row.amount_cents,null);await db.exec('rollback');}
 await db.exec(`insert into promoter_ledger_entries(order_id,promoter_id,event_id,amount_cents,entry_type) values('${order}','${promoter}',1,-100,'reversal')`);assert.equal((await summary(db)).rows[0].amount_cents,null);
 }finally{await db.close()}});
test('currencies remain separate and external/new-model history is never counted twice',async()=>{const db=await fixture();try{
 await db.exec(`INSERT INTO orders(id,event_id,promoter_id,status,currency,charge_model,total_cents) VALUES('00000000-0000-4000-8000-000000000012',1,'${promoter}','paid','eur',NULL,2000); INSERT INTO promoter_ledger_entries(order_id,promoter_id,event_id,amount_cents,entry_type,currency) VALUES('00000000-0000-4000-8000-000000000012','${promoter}',1,200,'earning','eur')`);await bind(db);assert.deepEqual((await summary(db)).rows.map(r=>r.currency).sort(),['eur','usd']);
 // Synthetic private table insert only: no claim that a real payment occurred.
 await db.exec(`INSERT INTO dvnt_settlement.checkouts(order_id,request_scope,snapshot,release_not_before,organizer_user_id) VALUES('${order}','synthetic-only','{}',now(),'fixture-host')`);assert.deepEqual((await summary(db)).rows.map(r=>r.currency),['eur']);
 }finally{await db.close()}});

test('later receipt-backed external settlement removes reviewed legacy display without modifying its binding',async()=>{const db=await fixture();try{
 await bind(db);
 await db.exec(`UPDATE event_promoters SET user_id='fixture-original'; UPDATE orders SET type='event_ticket',stripe_payment_intent_id='pi_fixture',promoter_commission_amount_cents=1000; INSERT INTO promoter_attributions(order_id,promoter_id) VALUES('${order}','${promoter}');
 INSERT INTO dvnt_settlement.external_operators VALUES('fixture-operator',true);
 INSERT INTO dvnt_settlement.external_recipients(id,promoter_id,provider,beneficiary_reference,verified_by,recipient_user_id) VALUES('00000000-0000-4000-8000-000000000003','${promoter}','fixture_provider','fixture-beneficiary','fixture-operator','fixture-original');`);
 const args={p_actor:'fixture-operator',p_request_key:'00000000-0000-4000-8000-000000000031',p_event_id:1,p_promoter_id:promoter,p_recipient_binding_id:'00000000-0000-4000-8000-000000000003',p_ledger_entry_ids:[ledger],p_amount_cents:1000,p_currency:'usd',p_provider:'fixture_provider',p_transaction_reference:'fixture-txn',p_receipt_sha256:'b'.repeat(64),p_receipt_reference:'fixture-vault/receipt/version-1',p_evidence_status:'completed',p_paid_at:'2026-01-01',p_receipt_beneficiary_reference:'fixture-beneficiary',p_attestation:{independently_checked_completed_final:true,receipt_retained:true,recipient_and_details_match:true}};
 const keys=Object.keys(args);await db.query(`select public.settlement_record_external_promoter_payment(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')})`,Object.values(args));
 assert.deepEqual((await summary(db)).rows,[]);assert.equal((await db.query('select count(*)::int n from dvnt_settlement.legacy_ownership')).rows[0].n,1);
 const external=(await db.query("select public.settlement_actor_summary('fixture-original',1) v")).rows[0].v;assert.equal(external.rows[0].stage,'paid_externally');
 }finally{await db.close()}});

test('original raw-table policies cannot leak prior financial rows to a reassigned authenticated member',async()=>{const db=await fixture();try{
 await bind(db);await db.exec(`UPDATE event_promoters SET user_id='fixture-reassigned'; INSERT INTO promoter_attributions(order_id,promoter_id) VALUES('${order}','${promoter}'); SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"fixture-reassigned"}',false);`);
 for(const table of ['promoter_ledger_entries','promoter_attributions'])await assert.rejects(db.exec('select * from public.'+table),/permission/);
 await db.exec('RESET ROLE');for(const table of ['promoter_ledger_entries','promoter_attributions'])assert.equal((await db.query("select has_table_privilege('service_role',$1,'SELECT') allowed",['public.'+table])).rows[0].allowed,true);
 assert.equal((await summary(db)).rows[0].amount_cents,1000);
 }finally{await db.close()}});
test('nullable source fields cannot admit a mismatched ownership attestation',async()=>{const db=await fixture();try{
 const created=(await db.query('select created_at from promoter_ledger_entries')).rows[0].created_at;
 for(const field of ['order_id','promoter_id','event_id','amount_cents','currency','entry_type','created_at']){
  await db.exec('BEGIN');await db.exec('ALTER TABLE promoter_ledger_entries ALTER COLUMN '+field+' DROP NOT NULL');await db.exec('UPDATE promoter_ledger_entries SET '+field+'=NULL');
  await assert.rejects(db.query(`INSERT INTO dvnt_settlement.legacy_ownership(ledger_entry_id,order_id,promoter_id,event_id,actor_id,amount_cents,currency,ledger_created_at,order_charge_model,order_total_cents,reviewed_by,evidence_reference,evidence_sha256) VALUES('${ledger}','${order}','${promoter}',1,'fixture-original',1000,'usd',$1,'destination_charge',11000,'fixture-reviewer','fixture-review/identity/version-1',repeat('a',64))`,[created]),/binding mismatch/);await db.exec('ROLLBACK');
 }
 }finally{await db.close()}});
test('mixed valid and null-drift bound rows never let bool_and ignore incomplete evidence',async()=>{const db=await fixture();try{
 // Actual schema disallows two earnings per order; relax only in this synthetic
 // corruption case to exercise aggregate NULL behavior across multiple rows.
 await db.exec('ALTER TABLE promoter_ledger_entries DROP CONSTRAINT promoter_ledger_entries_order_id_entry_type_key');
 await db.exec(`INSERT INTO promoter_ledger_entries(order_id,promoter_id,event_id,amount_cents,entry_type) VALUES('${order}','${promoter}',1,100,'earning')`);await bind(db);assert.equal((await summary(db)).rows[0].amount_cents,1100);
 await db.exec(`ALTER TABLE promoter_ledger_entries ALTER COLUMN currency DROP NOT NULL; UPDATE promoter_ledger_entries SET currency=NULL WHERE id='${ledger}'`);
 const r=(await summary(db)).rows[0];assert.equal(r.stage,'legacy_ownership_needs_review');assert.equal(r.amount_cents,null);
 }finally{await db.close()}});
