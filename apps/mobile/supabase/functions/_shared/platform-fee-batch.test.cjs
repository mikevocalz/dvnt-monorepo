// Actual helper with deterministic time and synthetic provider/lease state only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function clock(){
 let now=0,id=0;const timers=new Map();
 const c={now:()=>now,setTimeout(fn,ms){const key=++id;timers.set(key,{at:now+ms,fn});return key},clearTimeout(key){timers.delete(key)},sleep(ms){return new Promise(resolve=>c.setTimeout(resolve,ms))},signal(ms){const controller=new AbortController();c.setTimeout(()=>controller.abort(),ms);return controller.signal},advance(ms){now+=ms},async run(promise){let done=false,result,error;promise.then(x=>{done=true;result=x},e=>{done=true;error=e});for(let turns=0;!done&&turns<50000;turns++){for(let i=0;i<80;i++)await Promise.resolve();if(done)break;const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(next,'fake runtime stalled');now=Math.max(now,next[1].at);const due=[...timers].filter(([,x])=>x.at<=now);for(const [key,timer]of due){if(timers.delete(key))timer.fn()}}assert.ok(done,'fake runtime did not terminate');if(error)throw error;return result}};return c;
}
function fixture(count,options={}){
 const time=clock(),gets=[],calls=[],saved=[],rows=Array.from({length:count},(_,i)=>({payment_intent_id:`pi_Synthetic${i}`,expected_fee_cents:100,currency:'usd',lease_token:`lease-${i}`,state:'pending'}));
 let active=0,maxActive=0,lease=0;
 const db={rpc(name,args,signal){calls.push({name,args,at:time.now(),signal});assert.ok(signal instanceof AbortSignal);
   if((options.hangClaim&&name==='claim_platform_fee_snapshots')||(options.hangComplete&&name==='complete_platform_fee_snapshot'))return new Promise(()=>{});
   let data;if(name==='claim_platform_fee_snapshots'){data=rows.filter(r=>r.state==='pending').slice(0,args.p_limit);for(const row of data){row.state='refreshing';row.lease_token=`lease-${++lease}`}}
   else{const row=rows.find(r=>r.payment_intent_id===args.p_payment_intent_id);data=!!row&&row.state==='refreshing'&&row.lease_token===args.p_lease;if(data){row.state=args.p_error?'pending-error':'verified';saved.push({...args,at:time.now()})}}
   return time.sleep(options.databaseMs??10).then(()=>({data}));
 }};
 async function fetch(url,init){
   assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);
   const index=Number(url.match(/Synthetic(\d+)/)?.[1]);gets.push({url,index,at:time.now(),signal:init.signal});active++;maxActive=Math.max(maxActive,active);
   try{await new Promise((resolve,reject)=>{const timer=time.setTimeout(resolve,options.providerMs??20);init.signal.addEventListener('abort',()=>{time.clearTimeout(timer);reject(Error('timeout'))},{once:true})});
     if(options.rateLimit&&options.rateLimit(gets.length,index,url)){return{ok:false,status:429,headers:new Headers(options.retryAfter?{'retry-after':options.retryAfter}:{}),json:async()=>({})}}
     if(options.providerError)return{ok:false,status:503,headers:new Headers(),json:async()=>({})};
     const fee={id:`fee_Synthetic${index}`,object:'application_fee',amount:100,amount_refunded:10,currency:'usd',charge:`ch_Synthetic${index}`,account:'acct_Synthetic'};
     const charge={id:`ch_Synthetic${index}`,payment_intent:`pi_Synthetic${index}`,currency:'usd',paid:true,status:'succeeded',transfer_data:{destination:'acct_Synthetic'},application_fee:options.unexpanded?fee.id:fee};
     const pi={id:`pi_Synthetic${index}`,status:'succeeded',currency:'usd',latest_charge:options.unexpanded?charge.id:charge};
     return{ok:true,status:200,headers:new Headers(),json:async()=>url.includes('/payment_intents/')?pi:url.includes('/charges/')?charge:fee};
   }finally{active--}
 }
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'platform-fee-refund.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,fetch,AbortController,AbortSignal:{timeout:ms=>time.signal(ms)},setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,Date,Math,Promise,Set,Object,Number,encodeURIComponent});
 return{time,gets,calls,saved,rows,db,...exports,run:()=>exports.reconcilePlatformFeeSnapshots(db,'synthetic-secret',time),get maxActive(){return maxActive}};
}
function assertRate(gets,limit=12){for(const request of gets){assert.ok(gets.filter(x=>x.at>request.at-1000&&x.at<=request.at).length<=limit,`exceeded${limit}/s at${request.at}`)}}
for(const count of [1000,1207])test(`healthy${count} cohort drains within24h margin at four-hour cadence`,async()=>{
 const f=fixture(count);let runs=0,verified=0;const elapsed=[];
 while(f.rows.some(r=>r.state==='pending')){runs++;f.time.advance(4*60*60*1000);const start=f.time.now();const result=await f.time.run(f.run());elapsed.push(f.time.now()-start);verified+=result.verified;assert.ok(result.verified<=400);assert.equal(result.unavailable,0);assert.ok(f.time.now()-start<=110000)}
 assert.equal(runs,Math.ceil(count/400));assert.equal(verified,count);assert.ok(runs*4<24);assert.equal(f.saved.length,count);assert.equal(new Set(f.saved.map(x=>x.p_payment_intent_id)).size,count);assert.ok(Math.max(...elapsed)<40000);assertRate(f.gets);assert.ok(f.maxActive<=4);
});
test('all three fallback GET resources share rolling rate and concurrency budgets',async()=>{const f=fixture(600,{unexpanded:true});const result=await f.time.run(f.run());assert.ok(result.verified>=360&&result.verified<=400);assert.equal(result.unavailable,0);assert.equal(f.gets.length,result.verified*3);assertRate(f.gets);assert.ok(f.maxActive<=4);assert.ok(f.time.now()<=110000);assert.ok(f.rows.some(r=>r.state==='pending'))});
for(const [label,retryAfter,minimum]of [['seconds','8',8000],['HTTP date',new Date(8000).toUTCString(),8000],['missing',null,1000]])test(`429 ${label} pauses every later GET without immediate record retry`,async()=>{const f=fixture(32,{rateLimit:(_n,index)=>index<4,retryAfter});const result=await f.time.run(f.run());assert.equal(result.unavailable,4);assert.equal(result.verified,28);const first=f.gets.filter(g=>g.index<4),later=f.gets.filter(g=>g.index>=4);assert.ok(Math.min(...later.map(x=>x.at))-Math.max(...first.map(x=>x.at))>=minimum);assert.equal(first.length,4);assertRate(f.gets);assert.ok(f.saved.filter(s=>s.p_error).every(s=>s.p_refunded_cents===null))});
test('Retry-After beyond deadline stops claims and preserves pending rows',async()=>{const f=fixture(100,{rateLimit:()=>true,retryAfter:'3600'});const result=await f.time.run(f.run());assert.equal(result.unavailable,4);assert.equal(f.gets.length,4);assert.equal(f.calls.filter(c=>c.name==='claim_platform_fee_snapshots').length,1);assert.equal(f.rows.filter(r=>r.state==='pending').length,96);assert.ok(f.time.now()<110000)});
test('slow provider is aborted per request and leaves unavailable/pending, never fabricated zero',async()=>{const f=fixture(1000,{providerMs:15000});const result=await f.time.run(f.run());assert.equal(result.verified,0);assert.ok(result.unavailable>0&&result.unavailable<400);assert.ok(f.time.now()<=110000);assert.ok(f.gets.every(g=>g.signal.aborted));assert.ok(f.saved.every(s=>s.p_error&&s.p_amount_cents===null&&s.p_refunded_cents===null));assert.ok(f.rows.some(r=>r.state==='pending'))});
test('provider errors cannot be counted as verified or force a partial amount',async()=>{const f=fixture(500,{providerError:true});const result=await f.time.run(f.run());assert.equal(result.verified,0);assert.equal(result.unavailable,400);assert.ok(f.saved.every(s=>s.p_error&&s.p_refunded_cents===null));assertRate(f.gets)});
test('database claim hard timeout aborts signal and cannot trigger any provider reads',async()=>{const f=fixture(10,{hangClaim:true});await assert.rejects(()=>f.time.run(f.run()),/database timeout/);assert.equal(f.time.now(),3000);assert.equal(f.gets.length,0);assert.ok(f.calls[0].signal.aborted)});
test('database completion timeout preserves lease safety and stops further claiming',async()=>{const f=fixture(10,{hangComplete:true});const result=await f.time.run(f.run());assert.equal(result.verified,0);assert.equal(result.unavailable,4);assert.equal(f.calls.filter(c=>c.name==='claim_platform_fee_snapshots').length,1);assert.ok(f.calls.filter(c=>c.name==='complete_platform_fee_snapshot').every(c=>c.signal.aborted));assert.ok(f.time.now()<4000)});
test('overlapping invocations retain disjoint lease ownership and single completion per payment',async()=>{const f=fixture(700);const results=await f.time.run(Promise.all([f.run(),f.run()]));assert.equal(results.reduce((n,r)=>n+r.verified,0),700);assert.equal(f.gets.length,700);assert.equal(new Set(f.gets.map(g=>g.index)).size,700);assert.equal(new Set(f.saved.map(s=>s.p_payment_intent_id)).size,700);assert.ok(f.maxActive<=8);assertRate(f.gets,24)});

test('later queue outage retains completed progress without restarting or expanding the cohort',async()=>{const f=fixture(20);const original=f.db.rpc;let claims=0;f.db.rpc=(name,args,signal)=>{if(name==='claim_platform_fee_snapshots'&&++claims===2)return Promise.resolve({error:{message:'synthetic outage'}});return original(name,args,signal)};const result=await f.time.run(f.run());assert.equal(result.verified,4);assert.equal(result.unavailable,0);assert.equal(f.saved.length,4);assert.equal(f.rows.filter(r=>r.state==='pending').length,16);assert.equal(f.gets.length,4)});
