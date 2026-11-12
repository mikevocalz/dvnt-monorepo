const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
async function fixture(){const db=new PGlite();for(const f of ['scripts/fixtures/settlement/schema.sql','docs/payments/drafts/settlement-ledger.sql','docs/payments/drafts/settlement-runtime.sql','docs/payments/drafts/settlement-release-policy.sql','scripts/fixtures/settlement/approved-policy.sql','docs/payments/drafts/settlement-recovery.sql','docs/payments/drafts/settlement-outflows.sql'])await db.exec(fs.readFileSync(path.join(root,f),'utf8'));await db.exec("update dvnt_settlement.controls set checkout_enabled=true,transfers_enabled=true,release_delay_seconds=0; insert into dvnt_settlement.currency_reserves values('usd',200,'synthetic risk reserve');");return db;}
async function rpc(db,name,args={}){if(name==='settlement_reserve'&&args.p_balance_epoch==null)args={...args,p_balance_epoch:(await rpc(db,'settlement_balance_checkpoint')).epoch};const keys=Object.keys(args);return(await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args))).rows[0].v;}
async function order(db,suffix,{commission=1000,enroll=true}={}){const snapshot={rail:'create-payment-intent',selection:{ticket_type_id:'tier'},order:{user_id:'fixture-'+suffix,event_id:1,quantity:1,currency:'usd',total_cents:11000,subtotal_cents:10000,organizer_fee_cents:500,promoter_code:commission?'FIXTURE':null,promoter_commission_amount_cents:commission,promoter_commission_bps:commission?1000:0,promoter_customer_discount_bps:0}};
 const p=await rpc(db,'prepare_settlement_checkout',{p_snapshot:snapshot,p_request_key:'fixture-priority-'+suffix});await rpc(db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}});await rpc(db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_'+suffix,p_checkout_session_id:null});
 if(enroll)await rpc(db,'settlement_verify_source',{p_order_id:p.order_id,p_charge:'ch_'+suffix,p_pi:'pi_'+suffix,p_currency:'usd',p_gross:11000,p_tax:0});
 return {...await rpc(db,'settlement_order',{p_order_id:p.order_id}),suffix};}
function allocation(o,role){return o.allocations.find(a=>a.role===role);}
function reserve(db,a,balance){return rpc(db,'settlement_reserve',{p_allocation:a.id,p_destination:a.role==='promoter'?'acct_promoter':'acct_host',p_available:balance});}
async function settlePromoter(db,o){await db.exec("update event_promoters set stripe_account_id='acct_promoter'");const a=allocation(o,'promoter');await reserve(db,a,100000);await rpc(db,'settlement_reconcile_transfer',{p_allocation:a.id,p_transfer:'tr_'+o.suffix,p_destination:'acct_promoter',p_charge:'ch_'+o.suffix,p_currency:'usd',p_amount:1000});}

test('unonboarded promoter blocks only its host; healthy same-event order preserves that commission and risk floor',async()=>{const db=await fixture();try{const unpaid=await order(db,'unpaid');const healthy=await order(db,'healthy',{commission:0});
 await assert.rejects(reserve(db,allocation(unpaid,'organizer'),100000),/promoter settlement pending/);
 await assert.rejects(reserve(db,allocation(healthy,'organizer'),10699),/insufficient/);
 assert.equal((await reserve(db,allocation(healthy,'organizer'),10700)).amount,9500);
 assert.equal((await rpc(db,'settlement_order',{p_order_id:unpaid.order_id})).allocations.find(a=>a.role==='promoter').state,'held');
}finally{await db.close()}});

test('confirmed promoter unlocks exact frozen host remainder without claiming bank payment',async()=>{const db=await fixture();try{const o=await order(db,'confirmed');await settlePromoter(db,o);
 await assert.rejects(reserve(db,allocation(o,'organizer'),8699),/insufficient/);
 assert.equal((await reserve(db,allocation(o,'organizer'),8700)).amount,8500);
 const d=(await db.query('select bank_payout_state from dvnt_settlement.deliveries where allocation_id=$1',[allocation(o,'promoter').id])).rows[0];assert.equal(d.bank_payout_state,'unverified');
}finally{await db.close()}});

test('unknown promoter transfer blocks host and retains exactly one liability in shared balance',async()=>{const db=await fixture();try{const o=await order(db,'unknown');const healthy=await order(db,'independent',{commission:0});await db.exec("update event_promoters set stripe_account_id='acct_promoter'");await reserve(db,allocation(o,'promoter'),100000);await rpc(db,'settlement_uncertain',{p_allocation:allocation(o,'promoter').id,p_error:'synthetic timeout'});
 await assert.rejects(reserve(db,allocation(o,'organizer'),100000),/promoter settlement pending/);
 await assert.rejects(reserve(db,allocation(healthy,'organizer'),10699),/insufficient/);
 assert.equal((await reserve(db,allocation(healthy,'organizer'),10700)).amount,9500);
}finally{await db.close()}});

test('paid but unenrolled new-model commission remains protected; pending checkout is not funded',async()=>{const db=await fixture();try{const pending=await order(db,'unenrolled',{enroll:false});const healthy=await order(db,'funded',{commission:0});const before=await rpc(db,'settlement_balance_checkpoint');
 await db.query("update public.orders set status='paid' where id=$1",[pending.order_id]);
 const after=await rpc(db,'settlement_balance_checkpoint');assert.ok(after.epoch>before.epoch);
 await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:allocation(healthy,'organizer').id,p_destination:'acct_host',p_available:100000,p_balance_epoch:before.epoch}),/insufficient/);
 await assert.rejects(reserve(db,allocation(healthy,'organizer'),9700),/insufficient/);
 assert.equal((await reserve(db,allocation(healthy,'organizer'),10700)).amount,9500);
}finally{await db.close()}});

test('missing per-currency platform risk policy fails closed and cannot be modified by service or buyer',async()=>{const db=await fixture();try{const o=await order(db,'reserve',{commission:0});await db.exec('delete from dvnt_settlement.currency_reserves');await assert.rejects(reserve(db,allocation(o,'organizer'),100000),/policy missing/);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(db.exec("insert into dvnt_settlement.currency_reserves values('usd',0,'unreviewed')"),/permission/);await db.exec('reset role');}
}finally{await db.close()}});

test('refund and dispute hold remain effective after promoter completion and under owner exception',async()=>{for(const reason of ['refund','dispute']){const db=await fixture();try{const o=await order(db,reason);await settlePromoter(db,o);await db.exec("update dvnt_settlement.controls set owner_host_ids=ARRAY['fixture-host']; update events set payout_status='on_hold'; insert into dvnt_settlement.event_stops values(1,'dispute_only')");await rpc(db,'settlement_hold',{p_order_id:o.order_id,p_event_id:'evt_'+reason,p_reason:reason});await assert.rejects(reserve(db,allocation(o,'organizer'),100000),/held/);assert.equal((await rpc(db,'settlement_order',{p_order_id:o.order_id})).allocations.find(a=>a.role==='promoter').obligation_satisfied,false);
}finally{await db.close()}}});

test('commission is frozen at checkout before source enrollment and cannot be transferred as legacy',async()=>{const db=await fixture();try{const o=await order(db,'frozen',{enroll:false});await assert.rejects(db.query('update orders set promoter_commission_amount_cents=0 where id=$1',[o.order_id]),/immutable/);await assert.rejects(db.query("update orders set charge_model='destination_charge' where id=$1",[o.order_id]),/immutable/);assert.equal(o.allocations.length,0);assert.equal(o.snapshot.order.promoter_commission_amount_cents,1000);
}finally{await db.close()}});

test('already-paid enrollment takes budget lock and invalidates old balance without losing commission protection',async()=>{const db=await fixture();try{const pending=await order(db,'already_paid',{enroll:false});await db.query("update orders set status='paid' where id=$1",[pending.order_id]);const healthy=await order(db,'enrollment_target',{commission:0});const before=await rpc(db,'settlement_balance_checkpoint');await rpc(db,'settlement_verify_source',{p_order_id:pending.order_id,p_charge:'ch_already_paid',p_pi:'pi_already_paid',p_currency:'usd',p_gross:11000,p_tax:0});assert.ok((await rpc(db,'settlement_balance_checkpoint')).epoch>before.epoch);
 await assert.rejects(rpc(db,'settlement_reserve',{p_allocation:allocation(healthy,'organizer').id,p_destination:'acct_host',p_available:100000,p_balance_epoch:before.epoch}),/insufficient/);
 await assert.rejects(reserve(db,allocation(healthy,'organizer'),10699),/insufficient/);assert.equal((await reserve(db,allocation(healthy,'organizer'),10700)).amount,9500);
}finally{await db.close()}});
