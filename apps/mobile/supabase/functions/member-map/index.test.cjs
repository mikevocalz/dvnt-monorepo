const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function harness({auth=true,blocked=false,rateError=false,rpcError=null,presence=null,movementDenied=false}={}) {
 let handler;const calls=[];const rates=[];
 const source=ts.transpileModule(fs.readFileSync(__dirname+'/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports:{},Response,console,
  Deno:{env:{get:()=> 'test'},serve:fn=>handler=fn},
  require:name=>name.includes('supabase-js')?{createClient:()=>({
   from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:presence})};return q;},
   rpc:async(name,args)=>{calls.push({name,args});return {data:{fixture:true},error:rpcError};}
  })}
  :name.includes('verify-session')?{verifySessionDetailed:async()=>auth?{ok:true,userId:'signed-in-viewer'}:{ok:false}}
  :name.includes('verified-admission')?{resolveVerifiedAdmission:async()=>({state:blocked?'blocked':'allowed',message:'Verify'})}
  :name.includes('db-rate-limit')?{consumeDbRateLimit:async(...args)=>{rates.push(args);return {allowed:!rateError&&!(movementDenied&&String(args[2]).includes('move-')),error:rateError?'fixture':null};}}:{},
 });
 return {calls,rates,call:async body=>{
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({expectedAuthId:'signed-in-viewer',...body})}));
  return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
 }};
}
test('all actions authenticate, no user ID/center spoof reaches RPC',async()=>{
 for(const action of ['settings','revoke','nearby','publish','updateSettings']) {
  const h=harness({auth:false});assert.equal((await h.call({action})).status,401);assert.equal(h.calls.length,0);
 }
 const h=harness();await h.call({action:'nearby',userId:'victim',latitude:0,longitude:0,targetUsername:'victim'});
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{name:'member_map_nearby',args:{p_user_id:'signed-in-viewer'}});
});
test('events and overall withdrawal bypass verification/rate failures and never require settings read',async()=>{
 for(const scope of ['events','overall']) {
  const h=harness({blocked:true,rateError:true});const result=await h.call({action:'revoke',scope});
  assert.equal(result.status,200);assert.equal(h.rates.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{name:'member_map_revoke',args:{p_user_id:'signed-in-viewer',p_disable_overall:scope==='overall'}}]);
  assert.match(result.cache,/no-store/);
 }
});
test('permission, rate and revision failures fail closed without database details',async()=>{
 assert.equal((await harness({blocked:true}).call({action:'nearby'})).status,403);
 assert.equal((await harness({rateError:true}).call({action:'nearby'})).status,503);
 const h=harness({rpcError:{code:'40001',message:'secret database detail'}});
 const result=await h.call({action:'updateSettings',expectedRevision:0,locationEnabled:true,eventsMapEnabled:true,consentVersion:'events-map-v1'});
 assert.equal(result.status,409);assert.equal(result.body.code,'settings_changed');assert.doesNotMatch(JSON.stringify(result),/secret/);
});
test('publish rejects null, string and invalid values; sends verified actor with revision',async()=>{
 for(const latitude of [null,'40.7',true,86]) {
  const h=harness();assert.equal((await h.call({action:'publish',latitude,longitude:0,revision:1,observedAt:new Date().toISOString()})).status,400);assert.equal(h.calls.length,0);
 }
 const h=harness();assert.equal((await h.call({action:'publish',latitude:40.7,longitude:-74,revision:1,observedAt:new Date().toISOString()})).status,200);
 assert.equal(h.calls[0].args.p_user_id,'signed-in-viewer');
});
test('account switch mismatch fails before any settings, location or revoke RPC',async()=>{
 for(const action of ['settings','updateSettings','publish','nearby','revoke']) {
  const h=harness();const result=await h.call({action,expectedAuthId:'previous-account'});
  assert.equal(result.status,409);assert.equal(result.body.code,'account_changed');
  assert.equal(h.calls.length,0);assert.equal(h.rates.length,0);
 }
});
test('moved cells spend bounded database movement budgets, not same-cell refresh',async()=>{
 const input={action:'publish',latitude:40.71,longitude:0,revision:1,observedAt:new Date().toISOString()};
 const h=harness({movementDenied:true});assert.equal((await h.call(input)).status,429);assert.equal(h.calls.length,0);
 const same=harness({presence:{latitude:40.71,longitude:0},movementDenied:true});
 assert.equal((await same.call(input)).status,200);assert.equal(same.rates.some(args=>String(args[2]).includes('move-')),false);
 const moved=harness();await moved.call(input);
 assert.deepEqual(moved.rates.filter(args=>String(args[2]).includes('move-')).map(args=>args.slice(2)),[
  ['member-map-move-hour',4,3600],['member-map-move-day',12,86400]
 ]);
});
