/** Offline provider fixture + real PostgreSQL semantics through PGlite. */
const {test}=require('node:test');const assert=require('node:assert/strict');
const {setup,engine,funding}=require('./test-settlement-engine.cjs');
const tx=(id,net,{currency='usd',type='charge',status='available',source='ch_'+id}={})=>({id:'txn_'+id,object:'balance_transaction',source,type,currency,created:100,amount:net,fee:0,net,status});
async function other(f,suffix,{commission=1000,currency='usd'}={}){
 const snap=structuredClone((await f.candidate()).snapshot);snap.order.user_id='buyer_'+suffix;snap.order.currency=currency;
 if(!commission){snap.order.promoter_code=null;snap.order.promoter_commission_amount_cents=0;snap.order.promoter_commission_bps=0;}
 const p=await f.call('prepare_settlement_checkout',{p_snapshot:snap,p_request_key:'fixture-funding-'+suffix});
 await f.call('claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}});
 await f.call('finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_'+suffix,p_checkout_session_id:null});
 const charge=structuredClone(f.charge);Object.assign(charge,{id:'ch_'+suffix,payment_intent:'pi_'+suffix,currency});
 Object.assign(charge.balance_transaction,{id:'txn_'+suffix,source:charge.id,currency});
 return {...p,charge};
}
async function enroll(f,o){await f.call('settlement_verify_source',{p_order_id:o.order_id,p_charge:o.charge.id,p_pi:o.charge.payment_intent,p_currency:o.charge.currency,p_gross:11000,p_tax:0});await f.call('settlement_record_funding_source',{p_order_id:o.order_id,p_platform_account:'acct_platform_fixture',p_proof:funding.fundingSourceProof(o.charge,0)});}
async function audit(f,transactions,{currency='usd',available=100000,checkpoint}={}){const c=checkpoint||await f.call('settlement_balance_checkpoint',{});return f.call('settlement_record_funding_audit',{p_currency:currency,p_available:available,p_balance_epoch:c.epoch,p_started_at:c.observed_at,p_platform_account:'acct_platform_fixture',p_livemode:false,p_audit_from:0,p_transactions:transactions.map(t=>funding.fundingTransaction(t,0))});}

test('paid at Stripe but DB pending contributes no host funding; later verified enrollment protects its commission',async()=>{
 const f=await setup();try{
 const b=await other(f,'missing_webhook');f.extraTransactions.push(b.charge.balance_transaction,tx('prior_payout',-2000,{type:'payout',source:'po_prior'}));
 await f.run();assert.deepEqual(f.transfers.map(t=>t.destination),['acct_promoter']);
 assert.equal((await f.pg.query('select status from orders where id=$1',[b.order_id])).rows[0].status,'payment_pending');
 assert.equal((await f.pg.query('select credited_cents from dvnt_settlement.funding_audits')).rows[0].credited_cents,10500);
 await f.run();assert.equal(f.transfers.length,1); // Missing webhook/retry never recognizes another inflow.
 const checkpoint=await f.call('settlement_balance_checkpoint',{});await enroll(f,b);
 await assert.rejects(audit(f,[f.charge.balance_transaction,b.charge.balance_transaction],{checkpoint}),/stale/);
 await f.run();assert.deepEqual(f.transfers.map(t=>t.destination),['acct_promoter','acct_host']);
 const a=(await f.call('settlement_order',{p_order_id:b.order_id})).allocations.find(a=>a.role==='promoter');assert.equal(a.state,'held');
 const balance=(await f.pg.query('select available_cents from dvnt_settlement.funding_audits')).rows[0].available_cents;
 assert.ok(balance>=a.amount_cents+8500); // Snapshot before A host send includes B commission and B remainder.
 }finally{await f.pg.close();}
});

test('failed, expired, processing and abandoned attempts reserve no funds and never become source credits',async()=>{
 const f=await setup();try{
 // No attempt TTL is used to guess a payment outcome or release money.
 for(let n=0;n<40;n++)await other(f,'abandoned_'+n);
 for(const suffix of ['failed','expired','processing']){const b=await other(f,suffix);await f.pg.query('update orders set status=$2 where id=$1',[b.order_id,suffix==='failed'?'payment_failed':'payment_pending']);f.extraTransactions.push({...b.charge.balance_transaction,status:'pending'});}
 await f.run();assert.equal(f.transfers.length,2);
 assert.equal((await f.pg.query('select count(*)::int n from dvnt_settlement.funding_sources')).rows[0].n,1);
 assert.equal((await f.pg.query('select count(*)::int n from dvnt_settlement.allocations')).rows[0].n,2);
 }finally{await f.pg.close();}
});

test('all platform debit types count, available is only a ceiling, unknown positives and reversals are excluded',async()=>{
 const f=await setup();try{await f.run(false);await enroll(f,{order_id:f.p.order_id,charge:f.charge});
 const debits=['payout','transfer','refund','stripe_fee','adjustment','connect_collection_transfer'].map((type,i)=>tx('debit_'+i,-100,{type,status:i%2?'pending':'available',source:null}));
 const rows=[f.charge.balance_transaction,...debits,tx('unknown',999999),tx('unverified_reversal',100,{type:'transfer_refund'}),tx('eur_debit',-999999,{currency:'eur'})];
 const a=await audit(f,rows);assert.equal(a.available,9900);assert.equal((await audit(f,rows,{available:100})).available,100);
 // A known debit cannot disappear from later evidence or change its identity.
 assert.equal((await audit(f,[f.charge.balance_transaction])).available,9900);
 await assert.rejects(audit(f,[f.charge.balance_transaction,{...debits[0],net:-1,amount:-1}]),/immutable/);
 }finally{await f.pg.close();}
});

test('exact source transaction identity, immutable amount/fee/source and duplicate exclusion',async()=>{
 const f=await setup();try{await f.run(false);const o={order_id:f.p.order_id,charge:f.charge};await enroll(f,o);
 const proof=funding.fundingSourceProof(f.charge,0);assert.equal((await f.call('settlement_record_funding_source',{p_order_id:f.p.order_id,p_platform_account:'acct_platform_fixture',p_proof:proof})).duplicate,true);
 await assert.rejects(audit(f,[f.charge.balance_transaction,f.charge.balance_transaction]),/duplicate/);
 for(const altered of [{source:'ch_wrong'},{fee:499,net:10501},{currency:'eur'}])await assert.rejects(f.call('settlement_record_funding_source',{p_order_id:f.p.order_id,p_platform_account:'acct_platform_fixture',p_proof:{...proof,...altered}}),/mismatch/);
 const changed={...f.charge.balance_transaction,fee:499,net:10501};await assert.rejects(audit(f,[changed]),/mismatch/);
 await assert.rejects(f.call('settlement_record_funding_source',{p_order_id:f.p.order_id,p_platform_account:'acct_wrong',p_proof:proof}),/mismatch/);
 }finally{await f.pg.close();}
});

test('new cross-currency debit invalidates all old funding snapshots and stale audit cannot replace a newer one',async()=>{
 const f=await setup();try{await f.run(false);await enroll(f,{order_id:f.p.order_id,charge:f.charge});
 const c=await f.call('settlement_balance_checkpoint',{});const a=await audit(f,[f.charge.balance_transaction],{checkpoint:c});
 const b=await audit(f,[f.charge.balance_transaction,tx('eur',-100,{currency:'eur'})]);assert.ok(b.epoch>a.epoch);
 const host=(await f.candidate()).allocations.find(a=>a.role==='promoter');await assert.rejects(f.call('settlement_reserve',{p_allocation:host.id,p_destination:'acct_promoter',p_available:a.available,p_balance_epoch:a.epoch}),/stale/);
 await assert.rejects(audit(f,[f.charge.balance_transaction],{checkpoint:{...await f.call('settlement_balance_checkpoint',{}),observed_at:c.observed_at}}),/stale/);
 }finally{await f.pg.close();}
});

test('raw balance, stale snapshots and private low-level calls cannot bypass funding; policy is immutable',async()=>{
 const f=await setup();try{await f.run(false);const a=(await f.candidate()).allocations.find(a=>a.role==='promoter');const c=await f.call('settlement_balance_checkpoint',{});
 await assert.rejects(f.call('settlement_reserve',{p_allocation:a.id,p_destination:'acct_promoter',p_available:100000,p_balance_epoch:c.epoch}),/audit missing/);
 await assert.rejects(f.pg.exec('update dvnt_settlement.funding_policy set audit_from=100'),/immutable/);
 await assert.rejects(f.pg.exec('delete from dvnt_settlement.funding_policy'),/immutable/);
 for(const role of ['anon','authenticated','service_role']){await f.pg.exec('set role '+role);await assert.rejects(f.pg.exec('select dvnt_settlement.reserve_before_funding(null,null,100000,0)'),/permission/);await assert.rejects(f.pg.exec('select dvnt_settlement.reserve(null,null)'),/permission/);await assert.rejects(f.pg.exec("insert into dvnt_settlement.funding_policy values(true,'acct_other',false,0,'bad')"),/permission/);await f.pg.exec('reset role');}
 }finally{await f.pg.close();}
});

test('unknown transfer outcome stays reserved despite a huge new unattributed payment',async()=>{
 const f=await setup();try{let posts=0;f.provider.post=async()=>{posts++;throw Error('unknown')};f.extraTransactions.push(tx('huge_unattributed',999999));await f.run();await f.run();assert.equal(posts,1);assert.equal((await f.candidate()).allocations.find(a=>a.role==='organizer').state,'held');}finally{await f.pg.close();}
});

test('refund intent remains protected in addition to source debit; no successful source replay clears it',async()=>{
 const f=await setup();try{await f.run(false);await enroll(f,{order_id:f.p.order_id,charge:f.charge});const b=await other(f,'refund_other');await enroll(f,b);
 await f.call('settlement_refund_outflow_begin',{p_order_id:b.order_id,p_request_key:'fixture-refund-source-accounting',p_body:{payment_intent:b.charge.payment_intent,amount:'11000'}});
 f.extraTransactions.push(b.charge.balance_transaction,tx('refund',-11000,{type:'refund'}));
 await f.run();assert.equal(f.transfers.length,0);
 assert.equal((await f.pg.query("select dvnt_settlement.unsettled_outflows('usd') n")).rows[0].n,11000);
 }finally{await f.pg.close();}
});

test('funding pagination is exhaustive, bounded and stable; no truncated or changing audit authorizes a write',async()=>{
 const policy={platform_account:'acct_fixture',livemode:false,audit_from:0};const first=tx('one',100),second=tx('two',-1);
 let calls=0;const complete=await funding.auditFundingTransactions({get:async path=>{calls++;return {object:'list',data:path.includes('starting_after')?[second]:[first],has_more:!path.includes('starting_after')}}},policy);assert.equal(complete.length,2);assert.equal(calls,3);
 await assert.rejects(funding.auditFundingTransactions({get:async()=>({object:'list',data:[first],has_more:true})},policy,{maxPages:1}),/page limit/);
 await assert.rejects(funding.auditFundingTransactions({get:async()=>({object:'list',data:[first],has_more:true})},policy),/Duplicate/);
 calls=0;await assert.rejects(funding.auditFundingTransactions({get:async()=>({object:'list',data:++calls===1?[first]:[second,first],has_more:false})},policy),/changed/);
 await assert.rejects(funding.auditFundingTransactions({get:async()=>({object:'list',data:[],has_more:true})},policy),/stalled/);
 await assert.rejects(funding.auditFundingTransactions({get:async()=>({data:[first],has_more:false})},policy),/Incomplete/);
});


test('a pending balance transaction becoming available with the same ID does not bypass source membership',async()=>{
 const f=await setup();try{const b=await other(f,'availability');f.extraTransactions.push({...b.charge.balance_transaction,status:'pending'},tx('sweep',-9000,{type:'payout'}));await f.run();assert.equal(f.transfers.filter(t=>t.destination==='acct_host').length,0);f.extraTransactions[0].status='available';await f.run();assert.equal(f.transfers.filter(t=>t.destination==='acct_host').length,0);await enroll(f,b);await f.run();assert.equal(f.transfers.filter(t=>t.destination==='acct_host').length,1);}finally{await f.pg.close();}
});

test('processing and failed payment intent responses never enroll a source or send',async()=>{
 for(const status of ['processing','requires_payment_method','canceled']){const f=await setup();try{f.intent.status=status;await assert.rejects(f.run(),/invalid nonpaid intent proof/);Object.assign(f.intent,{amount_received:0,latest_charge:null});const r=await f.run();assert.equal(r.state,'awaiting_payment');assert.equal(f.transfers.length,0);assert.equal((await f.pg.query('select count(*)::int n from dvnt_settlement.funding_sources')).rows[0].n,0);}finally{await f.pg.close();}}
});

test('tax is never recognized as spendable and malformed actual fee/net proof fails closed',async()=>{
 const f=await setup();try{const b=await other(f,'tax');await f.call('settlement_verify_source',{p_order_id:b.order_id,p_charge:b.charge.id,p_pi:b.charge.payment_intent,p_currency:'usd',p_gross:11500,p_tax:500});b.charge.amount=11500;Object.assign(b.charge.balance_transaction,{amount:11500,fee:500,net:11000});const proof=funding.fundingSourceProof(b.charge,500);await f.call('settlement_record_funding_source',{p_order_id:b.order_id,p_platform_account:'acct_platform_fixture',p_proof:proof});assert.equal((await audit(f,[b.charge.balance_transaction])).available,10500);assert.throws(()=>funding.fundingSourceProof({...b.charge,balance_transaction:{...b.charge.balance_transaction,net:11500}},500),/Invalid/);await assert.rejects(f.call('settlement_record_funding_source',{p_order_id:b.order_id,p_platform_account:'acct_platform_fixture',p_proof:{...proof,tax:0}}),/mismatch/);}finally{await f.pg.close();}
});

test('credited currency cannot offset another currency and re-observed debit is counted only once',async()=>{
 const f=await setup();try{await f.run(false);await enroll(f,{order_id:f.p.order_id,charge:f.charge});const b=await other(f,'eur_source',{currency:'eur'});await enroll(f,b);const rows=[f.charge.balance_transaction,b.charge.balance_transaction,tx('usd_debit',-1000),tx('eur_debit',-10500,{currency:'eur'})];assert.equal((await audit(f,rows)).available,9500);assert.equal((await audit(f,rows)).available,9500);assert.equal((await audit(f,rows,{currency:'eur'})).available,0);assert.equal((await f.pg.query('select count(*)::int n from dvnt_settlement.funding_debits')).rows[0].n,2);}finally{await f.pg.close();}
});


test('pending negative is encumbered immediately and availability transition neither releases nor doubles it',async()=>{
 const f=await setup();try{await f.run(false);await enroll(f,{order_id:f.p.order_id,charge:f.charge});const debit=tx('pending_debit',-1000,{status:'pending',type:'payout'});const first=await audit(f,[f.charge.balance_transaction,debit]);debit.status='available';const next=await audit(f,[f.charge.balance_transaction,debit]);assert.equal(first.available,9500);assert.equal(next.available,9500);assert.equal(next.epoch,first.epoch);assert.equal((await f.pg.query('select count(*)::int n from dvnt_settlement.funding_debits')).rows[0].n,1);}finally{await f.pg.close();}
});

test('one order per charge and one immutable balance-transaction credit, including equal-amount wrong sources',async()=>{
 const f=await setup();try{await f.run(false);await enroll(f,{order_id:f.p.order_id,charge:f.charge});const b=await other(f,'duplicate_membership');
 await assert.rejects(f.call('settlement_verify_source',{p_order_id:b.order_id,p_charge:f.charge.id,p_pi:b.charge.payment_intent,p_currency:'usd',p_gross:11000,p_tax:0}),/unique|duplicate/);
 await f.call('settlement_verify_source',{p_order_id:b.order_id,p_charge:b.charge.id,p_pi:b.charge.payment_intent,p_currency:'usd',p_gross:11000,p_tax:0});
 const proof=funding.fundingSourceProof(b.charge,0);await assert.rejects(f.call('settlement_record_funding_source',{p_order_id:b.order_id,p_platform_account:'acct_platform_fixture',p_proof:{...proof,id:f.charge.balance_transaction.id}}),/unique|duplicate/);
 await assert.rejects(audit(f,[{...f.charge.balance_transaction,source:b.charge.id}]),/mismatch/);
 assert.equal((await f.pg.query('select count(*)::int n from dvnt_settlement.funding_sources')).rows[0].n,1);
 }finally{await f.pg.close();}
});
