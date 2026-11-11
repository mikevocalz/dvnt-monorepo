const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');const root=path.resolve(__dirname,'..');
function helper(){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'apps/mobile/supabase/functions/_shared/settlement-recovery.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console,URLSearchParams,encodeURIComponent});return exports;}
async function fixture(){const db=new PGlite();for(const f of ['scripts/fixtures/settlement/schema.sql','docs/payments/drafts/settlement-ledger.sql','docs/payments/drafts/settlement-runtime.sql','docs/payments/drafts/settlement-recovery.sql'])await db.exec(fs.readFileSync(path.join(root,f),'utf8'));return db;}
async function rpc(db,name,args){const keys=Object.keys(args);return(await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args))).rows[0].v;}
async function paid(db){await db.exec('update dvnt_settlement.controls set checkout_enabled=true,transfers_enabled=true,release_delay_seconds=86400');const snapshot={rail:'create-payment-intent',selection:{ticket_type_id:'tier'},order:{user_id:'buyer',event_id:1,quantity:2,currency:'usd',total_cents:11000,subtotal_cents:10000,organizer_fee_cents:500,platform_fee_cents:1000,dvnt_total_fee_cents:1000,promoter_code:'FIXTURE',promoter_commission_amount_cents:1000,promoter_commission_bps:1000,promoter_customer_discount_bps:0}};
const p=await rpc(db,'prepare_settlement_checkout',{p_snapshot:snapshot,p_request_key:'recovery-fixture-0001'});await rpc(db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}});await rpc(db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_fixture',p_checkout_session_id:null});await rpc(db,'settlement_verify_source',{p_order_id:p.order_id,p_charge:'ch_fixture',p_pi:'pi_fixture',p_currency:'usd',p_gross:11000,p_tax:0});return p;}
async function refund(db,orderId,id,extra={}){return rpc(db,'settlement_record_refund',{p_order_id:orderId,p_refund_id:id,p_charge_id:'ch_fixture',p_amount:5500,p_currency:'usd',p_full:false,p_eligible:5000,p_basis:10000,p_unit_key:'ticket:'+id,...extra});}
async function delivered(db,orderId){const a=(await db.query("select a.* from dvnt_settlement.allocations a where order_id=$1 and role='organizer'",[orderId])).rows[0];await db.query("update dvnt_settlement.deliveries set state='transferred',destination='acct_fixture',stripe_transfer_id='tr_fixture',reserved_at=now() where allocation_id=$1",[a.id]);return a;}
test('SQL partial allocation is admission-based, duplicate safe and bounded; unknown partial quarantines',async()=>{const db=await fixture();try{const p=await paid(db);
 assert.equal((await refund(db,p.order_id,'re_one')).quarantined,false);await refund(db,p.order_id,'re_one');
 assert.equal((await db.query('select sum(amount_cents)::int n from dvnt_settlement.recoveries')).rows[0].n,4750);
 const unknown=await refund(db,p.order_id,'re_unknown',{p_amount:100,p_eligible:null,p_basis:null,p_unit_key:null});assert.equal(unknown.quarantined,true);
 assert.equal((await db.query('select sum(amount_cents)::int n from dvnt_settlement.recoveries')).rows[0].n,4750);
 await refund(db,p.order_id,'re_full',{p_amount:5400,p_full:true,p_eligible:null,p_basis:null,p_unit_key:null});
 assert.equal((await db.query('select sum(amount_cents)::int n from dvnt_settlement.recoveries')).rows[0].n,9500);
 await refund(db,p.order_id,'re_again',{p_amount:1,p_full:true,p_eligible:null,p_basis:null,p_unit_key:null});assert.equal((await db.query('select sum(amount_cents)::int n from dvnt_settlement.recoveries')).rows[0].n,9500);
 assert.equal((await db.query('select blocked from dvnt_settlement.orders')).rows[0].blocked,true);
}finally{await db.close()}});
test('SQL reversal intent requires gate, proven transfer, once-only claim; uncertain is never blindly retried',async()=>{const db=await fixture();try{const p=await paid(db);const a=await delivered(db,p.order_id);await refund(db,p.order_id,'re_one');const r=(await db.query('select * from dvnt_settlement.recoveries where allocation_id=$1',[a.id])).rows[0];
 await assert.rejects(rpc(db,'settlement_claim_recovery',{p_recovery_id:r.id}),/disabled/);await db.exec('update dvnt_settlement.controls set recovery_enabled=true');
 const claim=await rpc(db,'settlement_claim_recovery',{p_recovery_id:r.id});assert.equal(claim.claimed,true);assert.equal(claim.transfer_id,'tr_fixture');await rpc(db,'settlement_uncertain_recovery',{p_recovery_id:r.id});assert.equal((await rpc(db,'settlement_claim_recovery',{p_recovery_id:r.id})).claimed,false);
 await assert.rejects(rpc(db,'settlement_finish_recovery',{p_recovery_id:r.id,p_reversal_id:'trr_fixture',p_amount:r.amount_cents+1}),/mismatch/);
 await rpc(db,'settlement_finish_recovery',{p_recovery_id:r.id,p_reversal_id:'trr_fixture',p_amount:r.amount_cents});await rpc(db,'settlement_uncertain_recovery',{p_recovery_id:r.id});assert.equal((await rpc(db,'settlement_recovery',{p_recovery_id:r.id})).state,'recovered');
}finally{await db.close()}});
test('SQL bank payout events alone never mark paid; exact proof, late failure and stale replay are monotonic',async()=>{const db=await fixture();try{const p=await paid(db);const a=await delivered(db,p.order_id);
 const event={p_account:'acct_fixture',p_payout:'po_fixture',p_event_id:'evt_paid',p_created:100,p_state:'paid'};await rpc(db,'settlement_bank_event',event);assert.equal((await db.query('select bank_payout_state from dvnt_settlement.deliveries where allocation_id=$1',[a.id])).rows[0].bank_payout_state,'unverified');
 const proof={account:'acct_fixture',transferId:'tr_fixture',destinationPayment:'py_fixture',transactionId:'txn_fixture',payoutId:'po_fixture',status:'paid',created:100,grossCents:a.amount_cents,netContributionCents:a.amount_cents-10,currency:'usd'};
 await rpc(db,'settlement_bank_proof',{p_allocation:a.id,p_proof:proof});await rpc(db,'settlement_bank_event',{...event,p_event_id:'evt_failed',p_created:200,p_state:'failed'});
 assert.equal((await rpc(db,'settlement_bank_proof',{p_allocation:a.id,p_proof:proof})).state,'failed');
 assert.equal((await db.query('select bank_payout_state from dvnt_settlement.deliveries where allocation_id=$1',[a.id])).rows[0].bank_payout_state,'failed');
 await assert.rejects(rpc(db,'settlement_bank_proof',{p_allocation:a.id,p_proof:{...proof,account:'acct_other'}}),/mismatch/);
}finally{await db.close()}});
test('SQL late proof cannot overwrite previously received payout failure; extension APIs service-only',async()=>{const db=await fixture();try{const p=await paid(db);const a=await delivered(db,p.order_id);await rpc(db,'settlement_bank_event',{p_account:'acct_fixture',p_payout:'po_fixture',p_event_id:'evt_failfirst',p_created:200,p_state:'failed'});
 assert.equal((await rpc(db,'settlement_bank_proof',{p_allocation:a.id,p_proof:{account:'acct_fixture',transferId:'tr_fixture',destinationPayment:'py_fixture',transactionId:'txn_fixture',payoutId:'po_fixture',status:'paid',created:100,grossCents:a.amount_cents,netContributionCents:a.amount_cents,currency:'usd'}})).state,'failed');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(rpc(db,'settlement_bank_candidates',{p_limit:100}),/permission/);await assert.rejects(refund(db,p.order_id,'re_untrusted'),/permission/);await db.exec('reset role')}
}finally{await db.close()}});
const recovery=helper();
test('refund interlock holds only actual SCT before provider flags are changed and propagates hold failure',async()=>{
 const calls=[];const db={from(){const q={select:()=>q,eq:()=>q,then:yes=>yes({data:[{id:'order',charge_model:'separate_charges_and_transfers'}],error:null})};return q},rpc:async(name,args)=>{calls.push({name,args});return{data:{ok:true}}}};
 const body={payment_intent:'pi_fixture',refund_application_fee:'true',reverse_transfer:'true'};
 const result=await recovery.beforeSettlementRefund(db,body);assert.equal(result.reverse_transfer,undefined);assert.equal(result['metadata[settlement_order_id]'],'order');assert.equal(calls[0].name,'settlement_hold');assert.equal(calls[0].args.p_reason,'refund');
 db.rpc=async()=>({error:{message:'hold failure'}});await assert.rejects(recovery.beforeSettlementRefund(db,body),/hold failure/);
 const legacy={from(){const q={select:()=>q,eq:()=>q,then:yes=>yes({data:[{id:'legacy',charge_model:'destination_charge'}],error:null})};return q},rpc:async()=>{throw Error('must not hold legacy')}};
 assert.equal(await recovery.beforeSettlementRefund(legacy,body),body);
});
test('eligible allocation uses discounted admission only, not gross buyer fees; unknown/cart partial remains unknown',()=>{
 const order={order_id:'order',stripe_payment_intent_id:'pi_fixture',snapshot:{selection:{ticket_type_id:'tier'},order:{subtotal_cents:10001,quantity:2}}};
 const ticket={id:'ticket',order_id:'order',ticket_type_id:'tier',stripe_payment_intent_id:'pi_fixture',order_index:1,order_count:2,purchase_amount_cents:6000};
 const eligible=recovery.eligibleRefundAllocation(order,{amount:6000},ticket);assert.equal(eligible.eligibleCents,5001);assert.equal(eligible.basisCents,10001);
 assert.equal(recovery.eligibleRefundAllocation(order,{amount:100},ticket),null);
 assert.equal(recovery.eligibleRefundAllocation({...order,snapshot:{...order.snapshot,selection:{lines:[]}}},{amount:6000},ticket),null);
 assert.equal(recovery.eligibleRefundAllocation(order,{amount:6000},{...ticket,order_id:'other'}),null);
});
test('reversal executor is gated, single claim and uncertain on timeout, read-only reconciliation verifies exact reversal',async()=>{
 const i={id:'recovery',allocation_id:'allocation',refund_id:'re_refund',transfer_id:'tr_transfer',amount_cents:100,idempotency_key:'recovery-key'};let claimed=false,posts=0,uncertain=0;
 const db={rpc:async(name)=>({data:name==='settlement_claim_recovery'?{...i,claimed:!claimed&&(claimed=true)}:name==='settlement_recovery'?i:(name==='settlement_uncertain_recovery'&&uncertain++,{ok:true})})};
 const provider={post:async()=>{posts++;throw Error('network timeout')},get:async()=>({data:[{id:'trr_reversal',transfer:'tr_transfer',amount:100,metadata:{settlement_recovery_id:i.id,settlement_allocation_id:i.allocation_id,refund_id:i.refund_id}}],has_more:false})};
 await assert.rejects(recovery.executeSettlementRecovery(db,provider,i.id),/disabled/);assert.equal(posts,0);
 await assert.rejects(recovery.executeSettlementRecovery(db,provider,i.id,true),/network/);assert.equal(posts,1);assert.equal(uncertain,1);
 await assert.rejects(recovery.executeSettlementRecovery(db,provider,i.id,true),/already attempted/);assert.equal(posts,1);
 assert.equal((await recovery.reconcileSettlementRecovery(db,provider,i.id)).ok,true);assert.equal(posts,1);
});
function bankProvider(patch={}){const calls=[];const a={id:'allocation',order_id:'order',stripe_transfer_id:'tr_fixture',destination:'acct_fixture',amount_cents:1000,currency:'usd'};
 const txn={id:'txn_fixture',source:'py_fixture',amount:1000,net:990,currency:'usd',status:'available'};
 const records={'/transfers/tr_fixture':{id:'tr_fixture',destination:'acct_fixture',amount:1000,currency:'usd',reversed:false,amount_reversed:0,destination_payment:'py_fixture',metadata:{settlement_allocation_id:a.id,settlement_order_id:a.order_id}},
 '/charges/py_fixture':{id:'py_fixture',source_transfer:'tr_fixture',amount:1000,currency:'usd',paid:true,status:'succeeded',balance_transaction:'txn_fixture'},
 '/balance_transactions/txn_fixture':txn,'/payouts/po_fixture':{id:'po_fixture',automatic:true,currency:'usd',status:'paid',created:100},
 '/balance_transactions?payout=po_fixture&limit=100':{data:[txn],has_more:false},...patch};
 return{a,calls,provider:{get:async(path,account)=>{calls.push({path,account});assert.equal(account,path.startsWith('/transfers/')?undefined:'acct_fixture');if(!(path in records))throw Error('unexpected path '+path);return records[path]},post:async()=>{throw Error('bank reconciliation must be read-only')}}};}
test('bank proof requires incoming charge, exact txn membership and account scoping, preserves net contribution',async()=>{
 const f=bankProvider();const proof=await recovery.verifyAllocationBankPayout(f.provider,f.a,'po_fixture');assert.equal(proof.status,'paid');assert.equal(proof.grossCents,1000);assert.equal(proof.netContributionCents,990);assert.equal(f.calls.length,5);
});
for(const [name,patch] of [['manual payout',{'/payouts/po_fixture':{id:'po_fixture',automatic:false,currency:'usd',status:'paid'}}],['unrelated membership',{'/balance_transactions?payout=po_fixture&limit=100':{data:[{id:'txn_other'}],has_more:false}}],['membership not ready',{'/balance_transactions?payout=po_fixture&limit=100':{data:[],has_more:false}}],['wrong incoming source',{'/charges/py_fixture':{id:'py_fixture',source_transfer:'tr_other',amount:1000,currency:'usd',paid:true,status:'succeeded',balance_transaction:'txn_fixture'}}]])test(`bank proof rejects ${name}`,async()=>{const f=bankProvider(patch);await assert.rejects(recovery.verifyAllocationBankPayout(f.provider,f.a,'po_fixture'));});
test('bank membership pagination must be exhausted before proof and supports reconciliation_completed trigger',async()=>{
 const f=bankProvider({'/balance_transactions?payout=po_fixture&limit=100':{data:[{id:'txn_other'}],has_more:true},'/balance_transactions?payout=po_fixture&limit=100&starting_after=txn_other':{data:[{id:'txn_fixture',source:'py_fixture',amount:1000,net:990,currency:'usd'}],has_more:false}});
 assert.equal((await recovery.verifyAllocationBankPayout(f.provider,f.a,'po_fixture')).status,'paid');const calls=[];
 await recovery.recordSettlementPayoutEvent({rpc:async(name,args)=>{calls.push({name,args});return{data:{ok:true}}}},{id:'evt_reconciled',account:'acct_fixture',created:200,type:'payout.reconciliation_completed',data:{object:{id:'po_fixture'}}});assert.equal(calls[0].args.p_state,'reconcile');
});
test('SQL fair scan leases progress beyond blocked bank/refund/recovery pages and wake on new signals',async()=>{const db=await fixture();try{const p=await paid(db);const a=await delivered(db,p.order_id);
 for(let i=0;i<5;i++)await rpc(db,'settlement_bank_event',{p_account:'acct_fixture',p_payout:'po_'+i,p_event_id:'evt_'+i,p_created:100+i,p_state:'paid'});
 const first=await rpc(db,'settlement_bank_candidates',{p_limit:2}),second=await rpc(db,'settlement_bank_candidates',{p_limit:2}),third=await rpc(db,'settlement_bank_candidates',{p_limit:2});
 assert.equal(first.length,2);assert.equal(second.length,2);assert.equal(third.length,1);assert.equal(new Set([...first,...second,...third].map(x=>x.payout_id)).size,5);
 assert.equal((await rpc(db,'settlement_bank_candidates',{p_limit:2})).length,0);
 await rpc(db,'settlement_bank_event',{p_account:'acct_fixture',p_payout:'po_4',p_event_id:'evt_reconciled',p_created:200,p_state:'reconcile'});
 assert.equal((await rpc(db,'settlement_bank_candidates',{p_limit:2}))[0].payout_id,'po_4');
 await refund(db,p.order_id,'re_first');assert.equal((await rpc(db,'settlement_refund_candidates',{p_limit:1})).length,1);assert.equal((await rpc(db,'settlement_refund_candidates',{p_limit:1})).length,0);await rpc(db,'settlement_recovery_wake',{p_order_id:p.order_id});assert.equal((await rpc(db,'settlement_refund_candidates',{p_limit:1})).length,1);
 await refund(db,p.order_id,'re_last',{p_full:true});
 const one=await rpc(db,'settlement_recovery_candidates',{p_limit:1}),two=await rpc(db,'settlement_recovery_candidates',{p_limit:1});assert.equal(one.length,1);assert.equal(two.length,1);assert.notEqual(one[0].id,two[0].id);
}finally{await db.close()}});
for(const pending of [false,true])test(`refund scanner requires fully succeeded provider refunds for full recovery (pending=${pending})`,async()=>{
 const recorded=[];const order={order_id:'order',stripe_payment_intent_id:'pi_fixture',snapshot:{order:{currency:'usd',subtotal_cents:10000,total_cents:11000,quantity:2},selection:{ticket_type_id:'tier'}}};
 const db={rpc:async(name,args)=>{if(name==='settlement_record_refund')recorded.push(args);return{data:name==='settlement_order'?order:{ok:true}}}};
 const charge={id:'ch_fixture',payment_intent:'pi_fixture',currency:'usd',amount:11000,amount_refunded:11000,refunded:true,paid:true,captured:true,status:'succeeded'};
 const provider={get:async path=>path.startsWith('/payment_intents/')?{id:'pi_fixture',latest_charge:'ch_fixture',amount:11000,metadata:{charge_model:'separate_charges_and_transfers',settlement_order_id:'order'}}:path.startsWith('/charges/')?charge:{data:[{id:'re_one',payment_intent:'pi_fixture',charge:'ch_fixture',currency:'usd',amount:5500,status:'succeeded',created:1},{id:'re_two',payment_intent:'pi_fixture',charge:'ch_fixture',currency:'usd',amount:5500,status:pending?'pending':'succeeded',created:2}],has_more:false}};
 await recovery.reconcileSettlementRefunds(db,provider,'order');assert.equal(recorded.length,pending?1:2);assert.ok(recorded.every(x=>x.p_full===!pending));
});
