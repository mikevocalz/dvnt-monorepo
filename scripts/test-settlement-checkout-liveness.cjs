const {test}=require('node:test');const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');const {resolve}=require('node:path');
const {setup}=require('./test-settlement-engine.cjs');const root=resolve(__dirname,'..');
const observe=(f,p_outcome,p_intent=null,p_session=null)=>f.call('settlement_checkout_observation',{p_order_id:f.p.order_id,p_outcome,p_intent,p_session});
const checkout=async f=>(await f.pg.query('SELECT * FROM dvnt_settlement.checkouts WHERE order_id=$1',[f.p.order_id])).rows[0];
const nonpaid=f=>({...f.intent,status:'requires_payment_method',amount_received:0,latest_charge:null});
const candidates=(f,n=100)=>f.call('settlement_candidates',{p_limit:n});
async function observationSchema(f){await f.pg.exec(readFileSync(resolve(root,'docs/payments/drafts/settlement-observability.sql'),'utf8'));}
// Bulk synthetic backlog avoids thousands of prepare RPCs. Actual target orders,
// observations, selection and provider handlers still enter the real SQL APIs.
async function backlog(f,cohort,n,{future=false,enrolled=false,state='held',unknown=false}={}) {
 if(future)await f.pg.exec("INSERT INTO events VALUES(2,'fixture-host','2099-01-01','pending','2098-12-20','published','2098-12-19') ON CONFLICT DO NOTHING; INSERT INTO dvnt_settlement.release_policies VALUES(2,'end_plus_five_business_days','UTC','synthetic future policy') ON CONFLICT DO NOTHING");
 const snapshot=(await f.candidate()).snapshot; snapshot.selection={fixture_cohort:cohort};snapshot.order.event_id=future?2:1;
 await f.pg.query(`WITH fixtures AS (SELECT md5($1||i)::uuid id FROM generate_series(1,$2::int) i)
 INSERT INTO orders(id,user_id,type,status,charge_model,event_id,quantity,currency,subtotal_cents,total_cents,organizer_fee_cents,stripe_payment_intent_id)
 SELECT id,'synthetic-'||id,'event_ticket',$3,'separate_charges_and_transfers',$4,1,'usd',10000,11000,500,'pi_fixture_'||replace(id::text,'-','') FROM fixtures`,[cohort,n,enrolled?'paid':'payment_pending',future?2:1]);
 await f.pg.query(`INSERT INTO dvnt_settlement.checkouts(order_id,request_scope,snapshot,created_at,attempted_at,release_not_before,organizer_user_id,outcome_unknown_since)
 SELECT md5($1||i)::uuid,$1||i,$3,now()-interval '1 day',now()-interval '1 day',$4::timestamptz,'fixture-host',CASE WHEN $5::boolean THEN now()-interval '2 hours' END FROM generate_series(1,$2::int) i`,[cohort,n,snapshot,future?'2099-01-01':'2020-01-01',unknown]);
 if(enrolled){
  await f.pg.query(`INSERT INTO dvnt_settlement.orders(order_id,charge_id,currency,gross_cents,distributable_cents,blocked,release_at)
   SELECT md5($1||i)::uuid,'ch_fixture_'||md5($1||i),'usd',11000,9500,false,$3::timestamptz FROM generate_series(1,$2::int) i`,[cohort,n,future?'2099-01-01':'2020-01-01']);
  await f.pg.query(`INSERT INTO dvnt_settlement.allocations(id,order_id,role,recipient_id,amount_cents)
   SELECT md5($1||'allocation'||i)::uuid,md5($1||i)::uuid,'organizer','fixture-host',9500 FROM generate_series(1,$2::int) i`,[cohort,n]);
  await f.pg.query(`INSERT INTO dvnt_settlement.deliveries(allocation_id,state,idempotency_key,destination,reserved_at,stripe_transfer_id)
   SELECT md5($1||'allocation'||i)::uuid,$3,$1||i,CASE WHEN $3<>'held' THEN 'acct_host' END,
    CASE WHEN $3<>'held' THEN now() END,CASE WHEN $3='recovery_required' THEN 'tr_fixture_'||md5($1||i) END FROM generate_series(1,$2::int) i`,[cohort,n,state]);
 }
}

test('unknown unlinked checkout alerts after tolerance despite healthy worker; future release and known nonpaid remain quiet',async()=>{const f=await setup({link:false});try{
 await observationSchema(f);const before=await checkout(f);
 await assert.rejects(f.run(false));let c=await checkout(f);assert.ok(c.outcome_unknown_since);assert.equal(c.retired_at,null);
 assert.equal((await f.call('settlement_health',{})).oldest_due_at,null);
 await f.pg.exec("UPDATE dvnt_settlement.checkouts SET outcome_unknown_since=now()-interval '2 hours'; UPDATE dvnt_settlement.controls SET last_worker_completed_at=now()");
 let h=await f.call('settlement_health',{});assert.ok(h.oldest_checkout_outcome_unknown_at);assert.equal(h.oldest_due_at,null);
 const first=(await checkout(f)).outcome_unknown_since;await assert.rejects(f.run(false));assert.deepEqual((await checkout(f)).outcome_unknown_since,first);
 await f.pg.exec("UPDATE events SET end_date=now()+interval '10 days'");assert.equal((await f.call('settlement_health',{})).oldest_checkout_outcome_unknown_at,null);
 await f.call('finalize_settlement_checkout',{p_order_id:f.p.order_id,p_payment_intent_id:f.intent.id,p_checkout_session_id:null});
 Object.assign(f.intent,nonpaid(f));assert.equal((await f.run(false)).state,'awaiting_payment');c=await checkout(f);assert.equal(c.outcome_unknown_since,null);assert.equal(c.retired_at,null);assert.ok(c.next_check_at);
 assert.equal((await f.call('settlement_health',{})).oldest_checkout_outcome_unknown_at,null);
 assert.equal((await f.candidate()).status,'payment_pending');assert.equal(f.transfers.length,0);assert.deepEqual(c.snapshot,before.snapshot);
}finally{await f.pg.close()}});

test('canceled proof rejects null malformed wrong and captured evidence without retiring or clearing unknown',async()=>{const f=await setup();try{
 await observe(f,'unknown');const good={...nonpaid(f),status:'canceled'};const invalid=[null,{},[],{...good,id:'pi_other'},{...good,metadata:{}},{...good,currency:'eur'},{...good,amount:10999},{...good,status:null},
 ...[null,undefined,-1,1,'0',0.1].map(amount_received=>({...good,amount_received})),{...good,latest_charge:'ch_previous'},
 {...good,transfer_data:{destination:'acct_other'}},{...good,application_fee_amount:0},{...good,on_behalf_of:'acct_other'},
 {...good,metadata:{...good.metadata,settlement_order_id:'wrong'}},{...good,metadata:{...good.metadata,charge_model:'destination_charge'}}];
 for(const proof of invalid){await assert.rejects(observe(f,'nonpaid',proof));const c=await checkout(f);assert.ok(c.outcome_unknown_since);assert.equal(c.retired_at,null);}
 await assert.rejects(observe(f,null));await assert.rejects(observe(f,'retired'));
 assert.equal((await observe(f,'nonpaid',good)).retired,true);assert.equal((await checkout(f)).outcome_unknown_since,null);
 assert.deepEqual(await candidates(f),[]);assert.equal((await f.candidate()).order_id,f.p.order_id);
 // Retired only affects polling. Verified provider evidence still enrolls via
 // the original source->controls lock and epoch path, never a new funding path.
 const epoch=(await f.call('settlement_balance_checkpoint',{})).epoch;await f.run(false);
 assert.equal((await checkout(f)).retired_at,null);assert.ok((await f.call('settlement_balance_checkpoint',{})).epoch>epoch);
 assert.equal((await f.candidate()).allocations.length,2);
}finally{await f.pg.close()}});

test('nonpaid observations never clear holds or financial states and cancel cannot retire a paid/enrolled obligation',async()=>{const f=await setup();try{
 const proof={...nonpaid(f),status:'canceled'};await f.call('settlement_hold',{p_order_id:f.p.order_id,p_event_id:'fixture_manual',p_reason:'manual'});
 await observe(f,'unknown');assert.equal((await observe(f,'nonpaid',proof)).retired,false);let c=await checkout(f);assert.equal(c.last_error,'hold:manual');assert.equal(c.outcome_unknown_since,null);
 await observe(f,'unknown');assert.equal((await checkout(f)).last_error,'hold:manual');
 await f.pg.query("UPDATE orders SET status='paid' WHERE id=$1",[f.p.order_id]);await assert.rejects(observe(f,'nonpaid',proof));assert.equal((await checkout(f)).retired_at,null);
 // Separate clean enrolled fixture below exercises held/reserved/uncertain.
}finally{await f.pg.close()}
 const g=await setup();try{await g.run(false);await g.pg.exec("UPDATE dvnt_settlement.deliveries SET state='uncertain',destination='acct_host',reserved_at=now() WHERE allocation_id=(SELECT id FROM dvnt_settlement.allocations WHERE role='organizer')");
 await g.call('settlement_hold',{p_order_id:g.p.order_id,p_event_id:'fixture_refund',p_reason:'refund'});const before=await g.pg.query('SELECT * FROM dvnt_settlement.deliveries ORDER BY allocation_id');
 await observe(g,'unknown');await assert.rejects(observe(g,'nonpaid',{...nonpaid(g),status:'canceled'}));assert.deepEqual((await g.pg.query('SELECT * FROM dvnt_settlement.deliveries ORDER BY allocation_id')).rows,before.rows);
 assert.equal((await checkout(g)).last_error,'hold:refund');assert.ok((await checkout(g)).outcome_unknown_since);assert.equal((await checkout(g)).retired_at,null);
}finally{await g.pg.close()}});

test('known awaiting attempts back off but never retire; due retry is bounded and verified status wakes scheduling',async()=>{const f=await setup();try{
 for(const status of ['requires_payment_method','requires_confirmation','requires_action','processing','requires_capture']){
  const p={...nonpaid(f),status};for(let i=0;i<9;i++)await observe(f,'nonpaid',p);
  const c=await checkout(f);assert.equal(c.retired_at,null);assert.equal(c.outcome_unknown_since,null);
  const wait=(c.next_check_at-new Date())/1000;assert.ok(wait>0&&wait<=3601);assert.deepEqual(await candidates(f),[]);
 }
 const explicit=await f.candidate();assert.equal(explicit.order_id,f.p.order_id);assert.equal((await checkout(f)).reconciliation_attempts,20);
 await f.pg.query("UPDATE orders SET status='paid' WHERE id=$1",[f.p.order_id]);assert.equal((await checkout(f)).next_check_at,null);
 assert.equal((await candidates(f))[0].order_id,f.p.order_id);
 await observe(f,'unknown');assert.ok((await checkout(f)).outcome_unknown_since);
 await f.run(false);const after=await checkout(f);assert.equal(after.outcome_unknown_since,null);assert.equal(after.reconciliation_attempts,0);assert.equal(after.next_check_at,null);
}finally{await f.pg.close()}});

test('expired hosted session or zero provider matches never establishes unpaid terminal safety',async()=>{const f=await setup({link:false});try{
 const get=f.provider.get;f.provider.get=async path=>path.startsWith('/v1/payment_intents?')?{data:[],has_more:false}:get(path);
 await assert.rejects(f.run(false),/0 matching/);assert.ok((await checkout(f)).outcome_unknown_since);assert.equal((await checkout(f)).retired_at,null);
 await f.call('finalize_settlement_checkout',{p_order_id:f.p.order_id,p_payment_intent_id:null,p_checkout_session_id:'cs_fixture'});
 f.provider.get=async path=>path.startsWith('/v1/checkout/sessions/')?{id:'cs_fixture',status:'expired',payment_status:'unpaid',payment_intent:null,currency:'usd',amount_subtotal:11000,metadata:f.intent.metadata}:get(path);
 await assert.rejects(f.run(false),/not yet linked/);assert.equal((await checkout(f)).retired_at,null);assert.ok((await checkout(f)).outcome_unknown_since);
}finally{await f.pg.close()}});

test('10,000 abandoned/future-held rows cannot postpone a new due enrolled allocation',async()=>{const f=await setup();try{
 await backlog(f,'abandoned',5000);await backlog(f,'future',5000,{future:true,enrolled:true});await f.run(false);
 const selected=await candidates(f);assert.equal(selected.length,100);assert.equal(selected[0].order_id,f.p.order_id);assert.ok(!selected.some(x=>x.snapshot.selection.fixture_cohort==='future'));
 assert.equal(new Set(selected.map(x=>x.order_id)).size,selected.length);
 const next=await candidates(f);assert.ok(next.some(x=>x.order_id===f.p.order_id));
}finally{await f.pg.close()}});

test('sustained four-way backlog reserves progress for recovery, due, unknown and pending with fair limits 1/2/3',async()=>{const f=await setup();try{
 // Retire the seed via exact proof so every selected row belongs to a cohort.
 await observe(f,'nonpaid',{...nonpaid(f),status:'canceled'});
 await backlog(f,'recovery',130,{future:true,enrolled:true,state:'uncertain'});await backlog(f,'due',130,{enrolled:true});await backlog(f,'unknown',130,{unknown:true});await backlog(f,'pending',130);
 const count=rows=>rows.reduce((out,x)=>{const k=x.snapshot.selection.fixture_cohort;out[k]=(out[k]||0)+1;return out},{});
 assert.deepEqual(count(await candidates(f)),{recovery:25,due:45,unknown:15,pending:15});
 for(const limit of [1,2,3]){
  const seen=new Set();for(let turn=0;turn<4;turn++){
   const rows=await candidates(f,limit);assert.equal(rows.length,limit);assert.equal(new Set(rows.map(r=>r.order_id)).size,limit);
   rows.forEach(x=>seen.add(x.snapshot.selection.fixture_cohort));
  }
  assert.deepEqual([...seen].sort(),['due','pending','recovery','unknown']);
 }
 // Last-check ordering rotates within permanent due/recovery cohorts.
 const first=await candidates(f);const second=await candidates(f);assert.ok(second.some(x=>!first.some(y=>y.order_id===x.order_id)));
}finally{await f.pg.close()}});

test('future rescheduled held rows defer only automatic scheduling; reserved/uncertain reconciliation survives pauses and holds',async()=>{const f=await setup();try{
 f.loseResponse();await f.run();assert.equal(f.transfers.length,1);
 await f.pg.exec("UPDATE events SET end_date='2099-01-01',payout_status='on_hold'; UPDATE dvnt_settlement.controls SET transfers_enabled=false");
 await f.call('settlement_hold',{p_order_id:f.p.order_id,p_event_id:'fixture_future_hold',p_reason:'manual'});
 const rows=await candidates(f);assert.equal(rows.length,1);assert.equal(rows[0].order_id,f.p.order_id);
 await assert.rejects(f.run(false));const fresh=await f.candidate();assert.equal(fresh.allocations.find(x=>x.role==='promoter').state,'recovery_required');
 assert.equal(fresh.allocations.find(x=>x.role==='organizer').state,'held');assert.equal(f.transfers.length,1);assert.equal((await checkout(f)).last_error,'hold:manual');
 assert.equal((await candidates(f))[0].order_id,f.p.order_id);
}finally{await f.pg.close()}});

test('observation and scheduling internals remain service-only with inherited public-schema default grants',async()=>{const f=await setup({defaultGrants:true});try{
 await observationSchema(f);await f.pg.exec(readFileSync(resolve(root,'docs/payments/drafts/settlement-watchdog.sql'),'utf8'));
 assert.equal(await f.call('claim_settlement_readiness_alert',{p_issue_codes:['checkout_outcome_unknown']}),true);
 assert.equal(await f.call('claim_settlement_readiness_alert',{p_issue_codes:['checkout_outcome_unknown']}),false);
 const sig='public.settlement_checkout_observation(uuid,text,jsonb,jsonb)';
 for(const role of ['anon','authenticated']){
  assert.equal((await f.pg.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') v',[role,sig])).rows[0].v,false);
  await f.pg.exec('SET ROLE '+role);await assert.rejects(observe(f,'unknown'),/permission/);await f.pg.exec('RESET ROLE');
 }
 assert.equal((await f.pg.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') v",[sig])).rows[0].v,true);
 for(const role of ['anon','authenticated','service_role'])for(const table of ['checkouts','queue_cursor'])assert.equal((await f.pg.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') v",[role,'dvnt_settlement.'+table])).rows[0].v,false);
 for(const fn of ['dvnt_settlement.wake_checkout_reconciliation()','public.settlement_health_base()'])assert.equal((await f.pg.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') v",[fn])).rows[0].v,false);
}finally{await f.pg.close()}});

test('hosted cancellation retires only with exact expired unpaid session and matching zero-charge canceled intent',async()=>{const f=await setup();try{
 await f.call('finalize_settlement_checkout',{p_order_id:f.p.order_id,p_payment_intent_id:f.intent.id,p_checkout_session_id:'cs_fixture'});
 const proof={...nonpaid(f),status:'canceled'};const session={id:'cs_fixture',metadata:f.intent.metadata,currency:'usd',amount_subtotal:11000,amount_total:11000,payment_intent:f.intent.id,payment_status:'unpaid',status:'open',total_details:{amount_tax:0,amount_discount:0,amount_shipping:0}};
 assert.equal((await observe(f,'nonpaid',proof,session)).retired,false);await observe(f,'unknown');
 for(const bad of [null,{}, {...session,id:'cs_wrong'},{...session,payment_intent:'pi_wrong'},{...session,metadata:{}},{...session,payment_status:'paid'},{...session,amount_total:12000},{...session,total_details:{amount_tax:null,amount_discount:0,amount_shipping:0}}]){
  await assert.rejects(observe(f,'nonpaid',proof,bad));assert.ok((await checkout(f)).outcome_unknown_since);assert.equal((await checkout(f)).retired_at,null);
 }
 assert.equal((await observe(f,'nonpaid',proof,{...session,status:'expired'})).retired,true);
}finally{await f.pg.close()}});

test('future held obligations stay explicitly retrievable and cannot release early after rescheduling',async()=>{const f=await setup();try{
 await f.run(false);await f.pg.exec("UPDATE events SET end_date='2099-01-01'");
 assert.deepEqual(await candidates(f),[]);assert.equal((await f.candidate()).allocations.length,2);
 await f.run(true);assert.equal(f.transfers.length,0);assert.ok((await f.candidate()).allocations.every(a=>a.state==='held'));
}finally{await f.pg.close()}});

test('a hosted rail with a missing durable session never retires from canceled intent alone',async()=>{const f=await setup();try{
 await f.pg.exec(`UPDATE dvnt_settlement.checkouts SET snapshot=jsonb_set(snapshot,'{rail}','"ticket-checkout"')`);
 await observe(f,'unknown');await assert.rejects(observe(f,'nonpaid',{...nonpaid(f),status:'canceled'}),/session proof/);
 assert.equal((await checkout(f)).retired_at,null);assert.ok((await checkout(f)).outcome_unknown_since);
}finally{await f.pg.close()}});

test('sequential dispatch keeps a new urgent recovery ahead of due rows and old pending spillovers',async()=>{const f=await setup();try{
 f.loseResponse();await f.run();assert.equal((await f.candidate()).allocations.find(a=>a.role==='promoter').state,'uncertain');
 await backlog(f,'older_pending_priority',120);await backlog(f,'due_priority',2,{enrolled:true});
 const selected=await candidates(f);assert.equal(selected.length,100);assert.equal(selected[0].order_id,f.p.order_id);
 assert.ok(selected.slice(1,3).every(x=>x.snapshot.selection.fixture_cohort==='due_priority'));
 assert.ok(selected.slice(3).every(x=>x.snapshot.selection.fixture_cohort==='older_pending_priority'));
 // Even if a slow handler reaches only its first item, that item is urgent.
 // Explicit lookup uses the same ordered aggregator for a singleton request.
 assert.equal((await f.candidate()).order_id,f.p.order_id);
}finally{await f.pg.close()}});

test('malformed provider IDs cannot bind or retire an existing malformed historical binding',async()=>{const f=await setup({link:false});try{
 for(const id of ['piXbad','pi_','pi_good/other',' pi_good'])await assert.rejects(f.call('finalize_settlement_checkout',{p_order_id:f.p.order_id,p_payment_intent_id:id,p_checkout_session_id:null}),/mismatch/);
 for(const id of ['csXbad','cs_','cs_good?other',' cs_good'])await assert.rejects(f.call('finalize_settlement_checkout',{p_order_id:f.p.order_id,p_payment_intent_id:null,p_checkout_session_id:id}),/mismatch/);
 assert.equal((await f.candidate()).stripe_payment_intent_id,null);assert.equal((await f.candidate()).stripe_checkout_session_id,null);
 // Model an already-bound historical bad ID so proof validation is independently
 // checked rather than relying only on the newly tightened binder.
 await f.pg.query('UPDATE orders SET stripe_payment_intent_id=$1 WHERE id=$2',['piXbad',f.p.order_id]);await observe(f,'unknown');
 await assert.rejects(observe(f,'nonpaid',{...nonpaid(f),id:'piXbad',status:'canceled'}),/intent proof/);
 assert.equal((await checkout(f)).retired_at,null);assert.ok((await checkout(f)).outcome_unknown_since);
}finally{await f.pg.close()}
 const g=await setup();try{
 await g.pg.query('UPDATE orders SET stripe_checkout_session_id=$1 WHERE id=$2',['csXbad',g.p.order_id]);await observe(g,'unknown');
 const session={id:'csXbad',metadata:g.intent.metadata,currency:'usd',amount_subtotal:11000,amount_total:11000,payment_intent:g.intent.id,payment_status:'unpaid',status:'expired',total_details:{amount_tax:0,amount_discount:0,amount_shipping:0}};
 await assert.rejects(observe(g,'nonpaid',{...nonpaid(g),status:'canceled'},session),/session proof/);
 assert.equal((await checkout(g)).retired_at,null);assert.ok((await checkout(g)).outcome_unknown_since);
}finally{await g.pg.close()}});
