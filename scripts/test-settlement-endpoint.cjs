const {test}=require('node:test');const assert=require('node:assert/strict');const {readFileSync}=require('node:fs');const {resolve}=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const {setup,engine}=require('./test-settlement-engine.cjs');const root=resolve(__dirname,'..');
const recovery={};vm.runInNewContext(ts.transpileModule(readFileSync(resolve(root,'apps/mobile/supabase/functions/_shared/settlement-recovery.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:recovery,Date,Set,Number,Error,encodeURIComponent});
function endpoint(db,provider,env={},extra={}){
 let handler;const headers=[];let creates=0;
 const code=readFileSync(resolve(root,'apps/mobile/supabase/functions/settlements-process/index.ts'),'utf8').replace(/^import[\s\S]*?from [^;]+;\n/gm,'');
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:{},withSentry:(_name,fn)=>fn,withHeartbeat:(_name,fn)=>fn(),...engine,...recovery,...extra,Response,Request,URLSearchParams,AbortSignal,
  Deno:{env:{get:k=>({SETTLEMENT_WORKER_SECRET:'fixture-worker-secret',STRIPE_SECRET_KEY:'fixture-provider-secret',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',...env})[k]},serve:fn=>handler=fn},
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
 const f=await setup();try{await f.pg.exec(readFileSync(resolve(root,'docs/payments/drafts/settlement-observability.sql'),'utf8'));
 const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true'});assert.equal((await h.call()).status,200);assert.equal(f.transfers.length,0);
 const enabled=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true',SETTLEMENT_TRANSFERS_ENABLED:'true'});const result=await enabled.call();assert.equal(result.status,200);assert.equal(f.transfers.length,2);assert.deepEqual(f.transfers.map(t=>t.destination),['acct_promoter','acct_host']);
 assert.ok(enabled.headers.every(x=>x['Stripe-Version']==='2026-09-30.endive'));
}finally{await f.pg.close()}});
test('bank verifier provider requests preserve connected account context and hide provider response errors',async()=>{
 const calls=[];const db={rpc:async()=>({data:[],error:null})};const p={get:async(path,account)=>{calls.push([path,account]);throw Error('private provider details')},post:async()=>{throw Error('unexpected write')}};
 const h=endpoint(db,p,{SETTLEMENT_WORKER_ENABLED:'true'},{reconcileSettlementBankEvents:async(_db,provider)=>{await provider.get('/v1/balance_transactions?limit=1','acct_fixture')}});
 const r=await h.call();const text=await r.text();assert.equal(r.status,200);assert.deepEqual(calls,[['/v1/account',undefined],['/v1/balance_transactions?limit=1','acct_fixture']]);assert.doesNotMatch(text,/sensitive|private|fixture-provider-secret/);assert.equal(h.headers[0]['Stripe-Account'],undefined);assert.equal(h.headers[1]['Stripe-Account'],'acct_fixture');
});

test('real worker observes provider-paid but unbound DB-pending failure despite recording a healthy run',async()=>{
 const f=await setup({link:false});try{await f.pg.exec(readFileSync(resolve(root,'docs/payments/drafts/settlement-observability.sql'),'utf8'));
 const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true'});const response=await h.call();assert.equal(response.status,200);
 const result=await response.json();assert.ok(result.results.some(x=>x.state==='held_for_reconciliation'));
 const health=await f.call('settlement_health',{});assert.ok(health.last_completed_at);assert.ok(health.oldest_checkout_outcome_unknown_at);assert.equal(health.oldest_due_at,null);
 assert.equal((await f.candidate()).status,'payment_pending');assert.equal(f.transfers.length,0);assert.equal(f.requests.filter(r=>r[0]==='POST').length,0);
 // Fresh provider retrieval can resolve the link and source even if no webhook
 // arrives. Automatic recheck is bounded; explicit source evidence also wakes.
 await f.pg.exec("UPDATE dvnt_settlement.checkouts SET next_check_at=now()-interval '1 second'");
 const get=f.provider.get;f.provider.get=async path=>path.startsWith('/v1/payment_intents?')?{data:[structuredClone(f.intent)],has_more:false}:get(path);
 const recovered=await h.call();assert.equal(recovered.status,200);assert.equal((await f.candidate()).status,'paid');
 assert.equal((await f.call('settlement_health',{})).oldest_checkout_outcome_unknown_at,null);assert.equal(f.transfers.length,0);
 }finally{await f.pg.close()}
});

test('real worker accepts known processing only after exact proof and does not page normal abandoned checkouts',async()=>{
 const f=await setup();try{await f.pg.exec(readFileSync(resolve(root,'docs/payments/drafts/settlement-observability.sql'),'utf8'));
 Object.assign(f.intent,{status:'processing',amount_received:0,latest_charge:null});
 const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true'});assert.equal((await h.call()).status,200);
 assert.equal((await f.call('settlement_health',{})).oldest_checkout_outcome_unknown_at,null);
 const c=(await f.pg.query('SELECT retired_at,next_check_at FROM dvnt_settlement.checkouts')).rows[0];assert.equal(c.retired_at,null);assert.ok(c.next_check_at);assert.equal(f.transfers.length,0);
 }finally{await f.pg.close()}
});

test('real worker rejects wrong nonpaid identities and partial canceled money instead of clearing an unknown observation',async()=>{
 const f=await setup();try{await f.pg.exec(readFileSync(resolve(root,'docs/payments/drafts/settlement-observability.sql'),'utf8'));
 const good={...f.intent,status:'canceled',amount_received:0,latest_charge:null};const h=endpoint(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true'});
 for(const bad of [{...good,id:'pi_wrong'},{...good,metadata:{}},{...good,amount_received:1},{...good,latest_charge:'ch_partial'},{...good,currency:'eur'}]){
  Object.assign(f.intent,bad);await f.pg.exec("UPDATE dvnt_settlement.checkouts SET next_check_at=NULL");
  const response=await h.call();assert.equal(response.status,200);assert.ok((await response.json()).results.some(x=>x.state==='held_for_reconciliation'));
  const c=(await f.pg.query('SELECT retired_at,outcome_unknown_since FROM dvnt_settlement.checkouts')).rows[0];assert.equal(c.retired_at,null);assert.ok(c.outcome_unknown_since);
 }
 assert.equal((await f.candidate()).status,'payment_pending');assert.equal(f.transfers.length,0);
 }finally{await f.pg.close()}
});
