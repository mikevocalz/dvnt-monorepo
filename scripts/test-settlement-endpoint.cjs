const {test}=require('node:test');const assert=require('node:assert/strict');const {readFileSync}=require('node:fs');const {resolve}=require('node:path');const vm=require('node:vm');const ts=require('typescript');
// setup loads the final artifact. Reinstalling a draft here could bypass its wrappers.
const {setup,engine}=require('./test-settlement-engine.cjs');const root=resolve(__dirname,'..');
const {issuePaidOrder}=require('./fixtures/settlement/issuance.cjs');
const recovery={};vm.runInNewContext(ts.transpileModule(readFileSync(resolve(root,'apps/mobile/supabase/functions/_shared/settlement-recovery.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:recovery,Date,Set,Number,Error,encodeURIComponent});
function loadCleanup(file){const path=require('node:path');const m={exports:{}};
 new Function('require','module','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(p=>loadCleanup(path.resolve(path.dirname(file),p)),m,m.exports);return m.exports;}
const cleanup=loadCleanup(resolve(root,'apps/mobile/supabase/functions/_shared/settlement-replacement-cleanup.ts'));
function endpoint(db,provider,env={},extra={}){
 let handler;const headers=[];let creates=0;
 const code=readFileSync(resolve(root,'apps/mobile/supabase/functions/settlements-process/index.ts'),'utf8').replace(/^import[\s\S]*?from [^;]+;\n/gm,'');
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:{},withSentry:(_name,fn)=>fn,withHeartbeat:(_name,fn)=>fn(),...engine,...recovery,...cleanup,...require('./fixtures/settlement/recipient.cjs'),performance,...extra,Response,Request,URLSearchParams,AbortSignal,
  Deno:{env:{get:k=>({SETTLEMENT_RUN_BUDGET_MS:'120000',SETTLEMENT_WORKER_SECRET:'fixture-worker-secret',STRIPE_SECRET_KEY:'fixture-provider-secret',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',...env})[k]},serve:fn=>handler=fn},
  createClient:()=>{creates++;return db},fetch:async(url,options)=>{headers.push(options.headers);const path=url.replace('https://api.stripe.com','');try{
   const value=options.method==='POST'?await provider.post(path,Object.fromEntries(new URLSearchParams(options.body)),options.headers['Idempotency-Key']):await provider.get(path,options.headers['Stripe-Account']);
   return Response.json(value);
  }catch{return Response.json({error:{message:'fixture sensitive provider payload',code:'fixture'}},{status:400});}},
 });return{headers,creates:()=>creates,call:(auth='Bearer fixture-worker-secret')=>handler(new Request('https://fixture.invalid/settlements-process',{method:'POST',headers:{Authorization:auth}}))};
}
test('actual worker entrypoint rejects missing auth and default-disabled rollout without DB or provider calls',async()=>{
 const h=endpoint(null,null);assert.equal((await h.call('Bearer wrong')).status,401);assert.equal((await h.call()).status,503);assert.equal(h.creates(),0);assert.equal(h.headers.length,0);
});
test('actual worker entrypoint + complete SQL + fake Stripe processes only explicitly enabled transfers',async()=>{
 const f=await setup();try{
 const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true'});assert.equal((await h.call()).status,200);assert.equal(f.transfers.length,0);
 const enabled=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true',SETTLEMENT_TRANSFERS_ENABLED:'true'});const result=await enabled.call();assert.equal(result.status,200);assert.equal(f.transfers.length,2);assert.deepEqual(f.transfers.map(t=>t.destination),['acct_promoter','acct_host']);
 assert.ok(enabled.headers.every(x=>x['Stripe-Version']==='2026-09-30.endive'));
}finally{await f.pg.close()}});
test('bank verifier provider requests preserve connected account context and hide provider response errors',async()=>{
 const calls=[];let turn=0;const db={rpc:async(name)=>({data:name==='settlement_worker_next_phase'?turn++%5:[],error:null})};const p={get:async(path,account)=>{calls.push([path,account]);throw Error('private provider details')},post:async()=>{throw Error('unexpected write')}};
 const h=endpoint(db,p,{SETTLEMENT_WORKER_ENABLED:'true'},{reconcileSettlementBankEvents:async(_db,provider)=>{if(calls.length>1)return [];await provider.get('/v1/balance_transactions?limit=1','acct_fixture')}});
 const r=await h.call();const text=await r.text();assert.equal(r.status,200);assert.deepEqual(calls,[['/v1/account',undefined],['/v1/balance_transactions?limit=1','acct_fixture']]);assert.doesNotMatch(text,/sensitive|private|fixture-provider-secret/);assert.equal(h.headers[0]['Stripe-Account'],undefined);assert.equal(h.headers[1]['Stripe-Account'],'acct_fixture');
});

test('real worker observes provider-paid but unbound DB-pending failure despite recording a healthy run',async()=>{
 const f=await setup({link:false});try{
 const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true'});const response=await h.call();assert.equal(response.status,200);
 const result=await response.json();assert.ok(result.results.some(x=>x.state==='held_for_reconciliation'));
 const health=await f.call('settlement_health',{});assert.ok(health.last_completed_at);assert.ok(health.oldest_checkout_outcome_unknown_at);assert.equal(health.oldest_due_at,null);
 assert.equal((await f.candidate()).status,'payment_pending');assert.equal(f.transfers.length,0);assert.equal(f.requests.filter(r=>r[0]==='POST').length,0);
 // Provider retrieval resolves the link, but only explicit canonical issuance
 // can unlock source verification. An unknown purchase remains recoverable.
 await f.pg.exec("UPDATE dvnt_settlement.checkouts SET next_check_at=now()-interval '1 second'");
 const get=f.provider.get;f.provider.get=async path=>path.startsWith('/v1/payment_intents?')?{data:[structuredClone(f.intent)],has_more:false}:get(path);
 const recovered=await h.call();assert.equal(recovered.status,200);
 assert.ok((await recovered.json()).results.some(x=>x.reason==='fulfillment_required'));
 assert.equal((await f.candidate()).status,'payment_pending');
 assert.equal((await f.pg.query('SELECT count(*)::int n FROM dvnt_settlement.orders')).rows[0].n,0);
 await issuePaidOrder(f.pg,f.p.order_id);
 await f.pg.exec('UPDATE dvnt_settlement.checkouts SET next_check_at=NULL');
 assert.equal((await h.call()).status,200);assert.equal((await f.candidate()).status,'paid');
 assert.equal((await f.call('settlement_health',{})).oldest_checkout_outcome_unknown_at,null);assert.equal(f.transfers.length,0);
 }finally{await f.pg.close()}
});

test('real worker accepts known processing only after exact proof and does not page normal abandoned checkouts',async()=>{
 const f=await setup({issue:false});try{
 Object.assign(f.intent,{status:'processing',amount_received:0,latest_charge:null});
 const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true'});assert.equal((await h.call()).status,200);
 assert.equal((await f.call('settlement_health',{})).oldest_checkout_outcome_unknown_at,null);
 const c=(await f.pg.query('SELECT retired_at,next_check_at FROM dvnt_settlement.checkouts')).rows[0];assert.equal(c.retired_at,null);assert.ok(c.next_check_at);assert.equal(f.transfers.length,0);
 }finally{await f.pg.close()}
});

test('real worker rejects wrong nonpaid identities and partial canceled money instead of clearing an unknown observation',async()=>{
 const f=await setup({issue:false});try{
 const good={...f.intent,status:'canceled',amount_received:0,latest_charge:null};const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true'});
 for(const bad of [{...good,id:'pi_wrong'},{...good,metadata:{}},{...good,amount_received:1},{...good,latest_charge:'ch_partial'},{...good,currency:'eur'}]){
  Object.assign(f.intent,bad);await f.pg.exec("UPDATE dvnt_settlement.checkouts SET next_check_at=NULL");
  const response=await h.call();assert.equal(response.status,200);assert.ok((await response.json()).results.some(x=>x.state==='held_for_reconciliation'));
  const c=(await f.pg.query('SELECT retired_at,outcome_unknown_since FROM dvnt_settlement.checkouts')).rows[0];assert.equal(c.retired_at,null);assert.ok(c.outcome_unknown_since);
 }
 assert.equal((await f.candidate()).status,'payment_pending');assert.equal(f.transfers.length,0);
 }finally{await f.pg.close()}
});

// Fake clock advances only at the actual HTTP adapter boundary; SQL, claims,
// proof verification and dispatch are the same implementations as production.
test('slow provider yields with durable phase progress and resumes without duplicate financial requests',async()=>{
 const f=await setup();try{

  let now=0;const get=f.provider.get,post=f.provider.post;
  f.provider.get=async(...args)=>{now+=5000;return get(...args)};
  f.provider.post=async(...args)=>{now+=5000;return post(...args)};
  const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true',SETTLEMENT_TRANSFERS_ENABLED:'true'},{performance:{now:()=>now}});
  let exhausted=false;
  for(let i=0;i<6;i++){const start=now;const r=await h.call();assert.equal(r.status,200);exhausted||=(await r.json()).budget_exhausted;assert.ok(now-start<=90000);}
  assert.equal(exhausted,true);assert.equal(f.transfers.length,2);
  assert.deepEqual(f.transfers.map(x=>x.destination),['acct_promoter','acct_host']);
  assert.equal(f.requests.filter(x=>x[0]==='POST').length,2);
 }finally{await f.pg.close()}
});
test('deadline after financial dispatch preserves ambiguity and reconciles rather than resending',async()=>{
 const f=await setup();try{

  let now=0;f.setAfterPost(async()=>{now+=90000});f.loseResponse();
  const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true',SETTLEMENT_TRANSFERS_ENABLED:'true'},{performance:{now:()=>now}});
  assert.equal((await h.call()).status,200);assert.equal(f.transfers.length,1);
  assert.equal((await f.pg.query("SELECT state FROM dvnt_settlement.deliveries WHERE state='uncertain'")).rows.length,1);
  f.setAfterPost(undefined);
  for(let i=0;i<3;i++)assert.equal((await h.call()).status,200);
  assert.equal(f.transfers.length,2);assert.equal(f.requests.filter(x=>x[0]==='POST').length,2);
 }finally{await f.pg.close()}
});
test('durable phase cursor rotates even across interrupted invocations and is private',async()=>{
 const f=await setup();try{

  const phases=[];for(let i=0;i<9;i++)phases.push(await f.call('settlement_worker_next_phase',{}));
  assert.deepEqual(phases,[0,1,2,3,4,0,1,2,3]);
  await f.pg.exec('set role authenticated');await assert.rejects(f.call('settlement_worker_next_phase',{}),/permission/);
 }finally{await f.pg.close()}
});
test('slow refund backlog cannot monopolize subsequent recovery, bank and order phases',async()=>{
 const f=await setup();try{

  let now=0;const phases=[];const underlying=f.db.rpc.bind(f.db);
  f.db.rpc=async(name,args)=>{
   if(name==='settlement_worker_next_phase'){const r=await underlying(name,args);phases.push(r.data);return r;}
   if(name==='settlement_refund_candidates')return {data:[{order_id:f.p.order_id}],error:null};
   return underlying(name,args);
  };
  const get=f.provider.get;f.provider.get=async(...args)=>{now+=30000;return get(...args)};
  const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true'},{performance:{now:()=>now}});
  for(let i=0;i<5;i++)assert.equal((await h.call()).status,200);
  assert.ok(phases.includes(0));assert.ok(phases.includes(1));assert.ok(phases.includes(2));assert.ok(phases.includes(3));
  assert.equal(f.transfers.length,0);assert.equal(f.requests.filter(x=>x[0]==='POST').length,0);
 }finally{await f.pg.close()}
});

test('worker refuses missing or invalid configured run budgets before any provider or financial RPC',async()=>{
 for(const budget of [undefined,'','NaN','59999','89999','600001','120000.5']){
  const db={rpc:()=>{throw Error('no RPC allowed')}};
  const h=endpoint(db,null,{SETTLEMENT_WORKER_ENABLED:'true',SETTLEMENT_TRANSFERS_ENABLED:'true',SETTLEMENT_RUN_BUDGET_MS:budget});
  const response=await h.call();assert.equal(response.status,503);assert.equal((await response.json()).error,'invalid_run_budget');assert.equal(h.headers.length,0);
 }
});
for(const phase of ['refund','recovery','bank'])test(`actual ${phase} helper budget catch persists attention and successful later proof clears it`,async()=>{
 const f=await setup();try{

  const phaseIndex={refund:0,recovery:1,bank:2}[phase];
  const a={id:'allocation',order_id:f.p.order_id,stripe_transfer_id:'tr_fixture',destination:'acct_fixture',amount_cents:1000,currency:'usd',payout_id:'po_fixture'};
  const recoveryId='recovery';const recoveryIntent={id:recoveryId,transfer_id:'tr_fixture',allocation_id:a.id,refund_id:'re_fixture',amount_cents:1000};
  const reversal={id:'trr_fixture',transfer:'tr_fixture',amount:1000,metadata:{settlement_recovery_id:recoveryId,settlement_allocation_id:a.id,refund_id:'re_fixture'}};
  const txn={id:'txn_fixture',source:'py_fixture',amount:1000,net:990,currency:'usd',status:'available'};
  const bank={
   '/v1/transfers/tr_fixture':{id:'tr_fixture',destination:a.destination,amount:1000,currency:'usd',reversed:false,amount_reversed:0,destination_payment:'py_fixture',metadata:{settlement_allocation_id:a.id,settlement_order_id:a.order_id}},
   '/v1/charges/py_fixture':{id:'py_fixture',source_transfer:'tr_fixture',amount:1000,currency:'usd',paid:true,status:'succeeded',balance_transaction:'txn_fixture'},
   '/v1/balance_transactions/txn_fixture':txn,'/v1/payouts/po_fixture':{id:'po_fixture',automatic:true,currency:'usd',status:'paid',created:100},
   '/v1/balance_transactions?payout=po_fixture&limit=100':{data:[txn],has_more:false},
  };
  let now=0,slow=true,chosen=false;const observed=[];const originalRpc=f.db.rpc.bind(f.db);
  f.db.rpc=async(name,args)=>{
   if(name.endsWith('_candidates')){
    if(name===`settlement_${phase}_candidates`&&!chosen){chosen=true;return{data:phase==='refund'?[{order_id:f.p.order_id}]:phase==='recovery'?[{id:recoveryId,state:'uncertain'}]:[a],error:null};}
    return{data:[],error:null};
   }
   if(name==='settlement_recovery')return{data:recoveryIntent,error:null};
   if(['settlement_bank_proof','settlement_finish_recovery'].includes(name))return{data:{state:'paid'},error:null};
   if(name==='settlement_worker_observation')observed.push(args);
   return originalRpc(name,args);
  };
  const get=f.provider.get;
  const provider={get:async(path,account)=>{
   if(slow)now+=phase==='bank'?20000:30000;
   if(path in bank)return bank[path];
   if(path.startsWith('/v1/transfers/tr_fixture/reversals'))return slow?{data:[{id:'trr_other'}],has_more:true}:{data:[reversal],has_more:false};
   if(path.startsWith('/v1/refunds?'))return{data:[],has_more:false};
   return get(path,account);
  },post:async()=>{throw Error('No financial dispatch allowed in reconciliation fixture')}};
  const h=endpoint(f.db,provider,{SETTLEMENT_WORKER_ENABLED:'true',SETTLEMENT_RUN_BUDGET_MS:phase==='bank'?'120000':'90000'},{performance:{now:()=>now}});
  await f.pg.exec(`UPDATE dvnt_settlement.controls SET worker_phase=${phaseIndex}`);
  const response=await h.call();assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.results.length,1);assert.equal(body.results[0].reason,'runtime_budget_required');
  const completed=observed.find(x=>x.p_phase==='completed');assert.equal(completed.p_summary.checked,1);assert.equal(completed.p_summary.needs_attention,1);
  const attention=(await f.pg.query('SELECT * FROM dvnt_settlement.runtime_attention')).rows;
  assert.equal(attention.length,1);assert.equal(attention[0].phase,phase);assert.equal((await f.call('settlement_health',{})).runtime_budget_blocked,1);
  const old=await f.call('settlement_worker_observation',{p_phase:'started'});
  await f.call('settlement_runtime_observation',{p_phase:phase,p_work_key:attention[0].work_key,p_outcome:'budget',p_run_started_at:old.observed_at});
  await f.call('settlement_runtime_observation',{p_phase:phase,p_work_key:attention[0].work_key,p_outcome:'completed',p_run_started_at:old.observed_at});
  assert.equal((await f.pg.query('SELECT * FROM dvnt_settlement.runtime_attention')).rows.length,1);
  slow=false;chosen=false;await f.pg.exec(`UPDATE dvnt_settlement.controls SET worker_phase=${phaseIndex}`);
  const resumed=await h.call();assert.equal(resumed.status,200);assert.equal((await f.pg.query('SELECT * FROM dvnt_settlement.runtime_attention')).rows.length,0);
  assert.equal(f.transfers.length,0);assert.equal(f.requests.filter(x=>x[0]==='POST').length,0);
 }finally{await f.pg.close()}
});
for(const stop of ['before_claim','after_dispatch'])test(`fifth cleanup phase preserves inventory and once-only cancellation on budget ${stop}`,async()=>{
 const {setup:cleanupFixture}=require('./fixtures/settlement/replacement-cleanup-db.cjs');
 const f=await cleanupFixture();try{
  let now=0,slow=true;const get=f.provider.get.bind(f.provider),post=f.provider.post.bind(f.provider);
  f.provider.get=async(path)=>{if(slow)now+=stop==='before_claim'&&path.startsWith('/v1/charges?')?30000:20000;return get(path)};
  f.provider.post=async(...args)=>{if(slow)now+=20000;return post(...args)};
  const h=endpoint(f.adapter,f.provider,{SETTLEMENT_WORKER_ENABLED:'true',CHECKOUT_REPLACEMENT_ENABLED:'true',CHECKOUT_REPLACEMENT_CLEANUP_ENABLED:'true'},{performance:{now:()=>now}});
  await f.db.exec('UPDATE dvnt_settlement.controls SET worker_phase=4');
  let response=await h.call();assert.equal(response.status,200);let body=await response.json();
  const result=body.results.find(x=>x.phase==='cleanup');assert.equal(result.reason,'runtime_budget_required');
  assert.equal(await f.held(),1);assert.equal(f.provider.posts,stop==='before_claim'?0:1);
  const q=(await f.db.query('SELECT attempted_at FROM dvnt_settlement.replacement_cleanup WHERE order_id=$1',[f.id])).rows[0];
  assert.equal(q.attempted_at===null,stop==='before_claim');
  const attention=(await f.db.query("SELECT * FROM dvnt_settlement.runtime_attention WHERE phase='cleanup'")).rows;assert.equal(attention.length,1);
  const summary=(await f.db.query('SELECT last_worker_summary FROM dvnt_settlement.controls')).rows[0].last_worker_summary;
  assert.equal(summary.checked,1);assert.equal(summary.needs_attention,1);
  slow=false;await f.db.exec("UPDATE dvnt_settlement.controls SET worker_phase=4; UPDATE dvnt_settlement.replacement_cleanup SET next_check_at=clock_timestamp()-interval '1 second'");
  response=await h.call();assert.equal(response.status,200);body=await response.json();assert.equal(body.results.find(x=>x.phase==='cleanup').cleanup_state,'released');
  assert.equal(f.provider.posts,1);assert.equal(await f.held(),0);
  assert.equal((await f.db.query("SELECT * FROM dvnt_settlement.runtime_attention WHERE phase='cleanup'")).rows.length,0);
 }finally{await f.db.close()}
});
test('fifth phase independently gates cleanup and empty scans terminate after all five phases',async()=>{
 const f=await setup();try{

  const calls=[];const rpc=f.db.rpc.bind(f.db);
  f.db.rpc=async(name,args)=>{calls.push([name,args]);if(name.endsWith('_candidates'))return{data:[],error:null};return rpc(name,args)};
  const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true',SETTLEMENT_TRANSFERS_ENABLED:'true',CHECKOUT_REPLACEMENT_ENABLED:'true'});
  assert.equal((await h.call()).status,200);assert.equal(calls.filter(x=>x[0]==='settlement_worker_next_phase').length,5);
  assert.equal(calls.some(x=>x[0]==='settlement_replacement_cleanup_candidates'),false);assert.equal(f.transfers.length,0);
  calls.length=0;
  const enabled=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true',CHECKOUT_REPLACEMENT_ENABLED:'true',CHECKOUT_REPLACEMENT_CLEANUP_ENABLED:'true'});
  assert.equal((await enabled.call()).status,200);assert.equal(calls.find(x=>x[0]==='settlement_replacement_cleanup_candidates')[1].p_limit,1);
  assert.equal(calls.filter(x=>x[0]==='settlement_worker_next_phase').length,5);
 }finally{await f.pg.close()}
});
test('independently fulfilled cleanup is successful and clears prior runtime attention without provider cancellation',async()=>{
 const {setup:cleanupFixture}=require('./fixtures/settlement/replacement-cleanup-db.cjs');
 const f=await cleanupFixture();try{
  const run=(await f.adapter.rpc('settlement_worker_observation',{p_phase:'started'})).data;
  assert.equal((await f.adapter.rpc('settlement_runtime_observation',{p_phase:'cleanup',p_work_key:f.id,p_outcome:'budget',p_run_started_at:run.observed_at})).error,null);
  await issuePaidOrder(f.db,f.id);
  const issuedOrder=(await f.db.query('SELECT total_cents FROM orders WHERE id=$1',[f.id])).rows[0];
  assert.equal((await f.adapter.rpc('settlement_verify_source',{p_order_id:f.id,p_charge:'ch_successor',p_pi:'pi_successor',p_currency:'usd',p_gross:issuedOrder.total_cents,p_tax:0})).error,null);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM dvnt_settlement.fulfillments WHERE order_id=$1',[f.id])).rows[0].n,1);
  await f.db.exec("UPDATE dvnt_settlement.controls SET worker_phase=4; UPDATE dvnt_settlement.checkouts SET next_check_at=clock_timestamp()+interval '1 day'");
  const h=endpoint(f.adapter,f.provider,{SETTLEMENT_WORKER_ENABLED:'true',CHECKOUT_REPLACEMENT_ENABLED:'true',CHECKOUT_REPLACEMENT_CLEANUP_ENABLED:'true'});
  const response=await h.call();assert.equal(response.status,200);const result=(await response.json()).results.find(x=>x.phase==='cleanup');
  assert.equal(result.state,'processed');assert.equal(result.cleanup_state,'fulfilled');assert.equal(result.reason,undefined);assert.equal(f.provider.posts,0);
  assert.equal((await f.db.query("SELECT * FROM dvnt_settlement.runtime_attention WHERE phase='cleanup'")).rows.length,0);
  const completed=(await f.db.query('SELECT last_worker_summary FROM dvnt_settlement.controls')).rows[0].last_worker_summary;
  assert.equal(completed.needs_attention,0);assert.equal(completed.checked,1);
  assert.deepEqual((await f.adapter.rpc('settlement_replacement_cleanup_candidates',{p_limit:1})).data,[]);
 }finally{await f.db.close()}
});
