const {test}=require('node:test');const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');const {resolve}=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=resolve(__dirname,'..');
async function fixture(){const db=new PGlite();
 for(const p of ['scripts/fixtures/settlement/schema.sql','docs/payments/drafts/settlement-ledger.sql','docs/payments/drafts/settlement-runtime.sql']) await db.exec(readFileSync(resolve(root,p),'utf8'));
 return db;
}
const snapshot=()=>({rail:'create-payment-intent',selection:{ticket_type_id:'fixture-tier'},order:{user_id:'fixture-buyer',event_id:1,quantity:1,currency:'usd',total_cents:11000,subtotal_cents:10000,organizer_fee_cents:500,platform_fee_cents:1000,dvnt_total_fee_cents:1000,promoter_code:'FIXTURE',promoter_commission_amount_cents:1000,promoter_commission_bps:1000,promoter_customer_discount_bps:0}});
async function rpc(db,name,args){if(name==='settlement_reserve'&&args.p_balance_epoch==null)args={...args,p_balance_epoch:(await db.query('select funding_epoch from dvnt_settlement.controls')).rows[0].funding_epoch};const keys=Object.keys(args);const {rows}=await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as v`,Object.values(args));return rows[0].v;}
async function prepare(db,s=snapshot(),key='fixture-request-0001'){return rpc(db,'prepare_settlement_checkout',{p_snapshot:s,p_request_key:key});}
async function enabled(db){await db.exec("update dvnt_settlement.controls set checkout_enabled=true,transfers_enabled=true,release_delay_seconds=86400; insert into dvnt_settlement.currency_reserves values('usd',0,'synthetic fixture only') on conflict do nothing");}
async function paid(db){await enabled(db);const p=await prepare(db);await rpc(db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}});await rpc(db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_fixture',p_checkout_session_id:null});await rpc(db,'settlement_verify_source',{p_order_id:p.order_id,p_charge:'ch_fixture',p_pi:'pi_fixture',p_currency:'usd',p_gross:11000,p_tax:0});return p;}

test('real checkout RPCs: disabled gate, durable snapshot, exact replay, claim once, immutable links',async()=>{
const db=await fixture();try{
 await assert.rejects(prepare(db),/disabled/);await enabled(db);const p=await prepare(db);assert.equal(p.charge_model,'separate_charges_and_transfers');assert.deepEqual(await prepare(db),p);
 assert.equal((await db.query('select count(*)::int n from orders')).rows[0].n,1);
 const changed=snapshot();changed.selection.ticket_type_id='other-tier';await assert.rejects(prepare(db,changed),/mismatch/);
 assert.equal((await rpc(db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}})).claimed,true);
 assert.equal((await rpc(db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'12000'}})).claimed,false);
 await rpc(db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_fixture',p_checkout_session_id:null});
 await assert.rejects(rpc(db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_other',p_checkout_session_id:null}),/mismatch/);
 await db.exec('update dvnt_settlement.controls set checkout_enabled=false');
 assert.equal((await rpc(db,'lookup_settlement_checkout',{p_rail:'create-payment-intent',p_request_key:'fixture-request-0001',p_user_id:'fixture-buyer',p_guest_email:null})).exists,true);
 await assert.rejects(prepare(db),/disabled/);
}finally{await db.close()}});

test('unverified guest repeats never return capability; changed promoter policy blocks new payment',async()=>{
const db=await fixture();try{await enabled(db);const s=snapshot();s.rail='guest-checkout';delete s.order.user_id;s.order.guest_email='fixture@example.invalid';await prepare(db,s);await assert.rejects(prepare(db,s),/guest replay/);
 await db.exec('update event_promoters set promoter_commission_bps=2000');await assert.rejects(prepare(db),/snapshot changed/);
}finally{await db.close()}});

test('source enrollment and late onboarding preserve allocations; global funds reservations and owner exception stay scoped',async()=>{
const db=await fixture();try{const p=await paid(db);const order=await rpc(db,'settlement_order',{p_order_id:p.order_id});assert.equal(order.allocations.length,2);
 const host=order.allocations.find(a=>a.role==='organizer'),promoter=order.allocations.find(a=>a.role==='promoter');assert.equal(host.candidate_destination,'acct_host');assert.equal(promoter.candidate_destination,null);
 await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:host.id,p_destination:'acct_host',p_available:-1}),/insufficient/);
 await db.exec("update events set payout_status='on_hold'");await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:host.id,p_destination:'acct_host',p_available:10000}),/event dispute/);
 await db.exec("update dvnt_settlement.controls set owner_host_ids=ARRAY['fixture-host']; INSERT INTO dvnt_settlement.event_stops VALUES(1,'dispute_only')");
 await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:host.id,p_destination:'acct_host',p_available:10000}),/promoter settlement pending/);
 await db.exec("update event_promoters set stripe_account_id='acct_promoter'");
 await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:promoter.id,p_destination:'acct_promoter',p_available:999}),/insufficient/);
 await rpc(db,'settlement_reserve',{p_allocation:promoter.id,p_destination:'acct_promoter',p_available:10000});
 await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:promoter.id,p_destination:'acct_promoter',p_available:20000}),/reconcile/);
 await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:host.id,p_destination:'acct_host',p_available:20000}),/promoter settlement pending/);
 await rpc(db,'settlement_reconcile_transfer',{p_allocation:promoter.id,p_transfer:'tr_promoter',p_destination:'acct_promoter',p_charge:'ch_fixture',p_currency:'usd',p_amount:1000});
 const r=await rpc(db,'settlement_reserve',{p_allocation:host.id,p_destination:'acct_host',p_available:9000});assert.equal(r.amount,8500);
}finally{await db.close()}});

test('refund holds before enrollment and after reservation survive verified source replays',async()=>{
const db=await fixture();try{await enabled(db);const p=await prepare(db);await rpc(db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}});await rpc(db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_fixture',p_checkout_session_id:null});
 await rpc(db,'settlement_hold',{p_order_id:p.order_id,p_event_id:'re_fixture',p_reason:'refund'});
 await assert.rejects(rpc(db,'settlement_verify_source',{p_order_id:p.order_id,p_charge:'ch_fixture',p_pi:'pi_fixture',p_currency:'usd',p_gross:11000,p_tax:0}),/not eligible/);
}finally{await db.close()}});

test('hosted tax finalization never allocates taxes and mismatched source replays fail',async()=>{
const db=await fixture();try{await enabled(db);const s=snapshot();s.rail='ticket-checkout';const p=await prepare(db,s);await rpc(db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{mode:'payment'}});await rpc(db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_fixture',p_checkout_session_id:'cs_fixture'});
 await rpc(db,'settlement_verify_source',{p_order_id:p.order_id,p_charge:'ch_fixture',p_pi:'pi_fixture',p_currency:'usd',p_gross:11500,p_tax:500});
 assert.deepEqual((await db.query('select total_cents,tax_cents from orders')).rows[0],{total_cents:11500,tax_cents:500});
 assert.equal((await db.query('select sum(amount_cents)::int n from dvnt_settlement.allocations')).rows[0].n,9500);
 await assert.rejects(rpc(db,'settlement_verify_source',{p_order_id:p.order_id,p_charge:'ch_other',p_pi:'pi_fixture',p_currency:'usd',p_gross:11500,p_tax:500}),/mismatch/);
 await db.exec("update orders set status='disputed'");assert.equal((await db.query('select blocked from dvnt_settlement.orders')).rows[0].blocked,true);
}finally{await db.close()}});

test('all checkout/execution RPCs reject untrusted roles',async()=>{const db=await fixture();try{for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(prepare(db),/permission/);await assert.rejects(rpc(db,'settlement_candidates',{p_limit:100}),/permission/);await db.exec('reset role')}}finally{await db.close()}});
module.exports={fixture,rpc,snapshot,enabled,paid};

test('more than 100 blocked orders cannot starve newer payable work',async()=>{
 const db=await fixture();try{await enabled(db);let newest;
 for(let i=0;i<102;i++){const s=snapshot();s.order.user_id='fixture-buyer-'+i;const p=await prepare(db,s,'fixture-queue-'+String(i).padStart(6,'0'));newest=p.order_id;await rpc(db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}});if(i<101)await rpc(db,'settlement_hold',{p_order_id:p.order_id,p_event_id:'hold_'+i,p_reason:'manual'});}
 const first=await rpc(db,'settlement_candidates',{p_limit:100});const second=await rpc(db,'settlement_candidates',{p_limit:100});
 assert.equal(first.length,100);assert.ok(!first.some(r=>r.order_id===newest));assert.ok(second.some(r=>r.order_id===newest));
 }finally{await db.close()}
});
test('funding epoch rejects a stale available balance after transfer commit',async()=>{
 const db=await fixture();try{const p=await paid(db);const o=await rpc(db,'settlement_order',{p_order_id:p.order_id});const host=o.allocations.find(a=>a.role==='organizer');const promo=o.allocations.find(a=>a.role==='promoter');
 await db.exec("update event_promoters set stripe_account_id='acct_promoter'");
 const checkpoint=await rpc(db,'settlement_balance_checkpoint',{});await rpc(db,'settlement_reserve',{p_allocation:promo.id,p_destination:'acct_promoter',p_available:10000,p_balance_epoch:checkpoint.epoch});
 await rpc(db,'settlement_reconcile_transfer',{p_allocation:promo.id,p_transfer:'tr_fixture',p_destination:'acct_promoter',p_charge:'ch_fixture',p_currency:'usd',p_amount:1000});
 await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:host.id,p_destination:'acct_host',p_available:10000,p_balance_epoch:checkpoint.epoch}),/insufficient/);
 }finally{await db.close()}
});
test('frozen recipient ownership survives host and promoter account-link changes',async()=>{
 const db=await fixture();try{await enabled(db);const p=await prepare(db);await rpc(db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}});await rpc(db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_fixture',p_checkout_session_id:null});
 await db.exec("update events set host_id='fixture-new-owner'; update event_promoters set user_id='fixture-new-promoter'; insert into organizer_accounts values('fixture-new-promoter','acct_other')");
 await rpc(db,'settlement_verify_source',{p_order_id:p.order_id,p_charge:'ch_fixture',p_pi:'pi_fixture',p_currency:'usd',p_gross:11000,p_tax:0});
 const o=await rpc(db,'settlement_order',{p_order_id:p.order_id});assert.equal(o.allocations.find(a=>a.role==='organizer').recipient_id,'fixture-host');assert.equal(o.allocations.find(a=>a.role==='promoter').candidate_destination,null);
 const hidden=await rpc(db,'settlement_actor_summary',{p_actor:'fixture-new-owner',p_event_id:1});assert.deepEqual(hidden.rows,[]);
 assert.ok((await rpc(db,'settlement_actor_summary',{p_actor:'fixture-host',p_event_id:1})).rows.length>0);
 }finally{await db.close()}
});
test('manual/disabled/cancelled event stops and later reschedules are never bypassed for owners',async()=>{
 const db=await fixture();try{const p=await paid(db);const a=(await rpc(db,'settlement_order',{p_order_id:p.order_id})).allocations.find(a=>a.role==='organizer');await db.exec("update dvnt_settlement.controls set owner_host_ids=ARRAY['fixture-host']");
 for(const change of ["payout_status='on_hold'","payout_status='disabled'","payout_status='pending',status='cancelled'","status='published',end_date='2099-01-01T19:00:00-05:00'"]){await db.exec('update events set '+change);await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:a.id,p_destination:'acct_host',p_available:100000}),/hold|pending/);}
 const utc=(await db.query("select to_char(end_date at time zone 'UTC','YYYY-MM-DD HH24:MI') t from events")).rows[0].t;assert.match(String(utc),/2099-01-02/);
 }finally{await db.close()}
});
