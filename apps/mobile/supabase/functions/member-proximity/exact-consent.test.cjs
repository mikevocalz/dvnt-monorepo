const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
function harness(options={}) {
 let handler; const writes=[]; const until=new Date(Date.now()+(options.leaseMs||60000)).toISOString();
 const db={from:table=>{const f={};let op='read';let value;const q={select:()=>q,eq:(k,v)=>{f[k]=v;return q},gt:()=>q,
 delete:()=>{op='delete';return q},upsert:v=>{op='upsert';value=v;return q},
 then:(yes,no)=>q.maybeSingle().then(yes,no),maybeSingle:async()=>{
 if(op!=='read'){writes.push({table,op,value});return {error:null}}
 if(table==='users')return {data:{id:2,auth_id:'target',is_private:options.private}};
 if(table==='blocks')return options.block?{error:{}}:{data:null};
 if(table==='follows')return {data:null};
 if(table==='identity_verifications')return {data:{status:options.minor===f.user_id?'failed':'passed',date_of_birth:'1990-01-01'}};
 if(table==='member_map_settings')return {data:{location_enabled:true}};
 if(table==='member_proximity_presence')return {data:{latitude:40+(f.user_id==='target'?0.001:0),longitude:-74,share_until:until,exact_session_id:options.bothLegacy||options.legacy===f.user_id?null:f.user_id+'session',exact_observed_at:options.bothLegacy||options.legacy===f.user_id?null:options.observation===undefined?new Date(Date.now()-1000).toISOString():options.observation}};
 if(table==='member_exact_distance_consent')return options.legacy===f.user_id?{data:null}:{data:{session_id:f.user_id+'session',expires_at:until,consent_version:options.version||2}};
 if(table==='session')return options.revoked===f.userId?{data:null}:{data:{id:f.id,userId:f.userId,expiresAt:options.expired===f.userId?'2000-01-01':until}};
 throw Error(table);
 }};return q}};
 const source=ts.transpileModule(fs.readFileSync(__dirname+'/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports:{},Response,console,Deno:{env:{get:()=> 'test'},serve:f=>handler=f},require:n=>n.includes('supabase-js')?{createClient:()=>db}:n.includes('location-session')?{verifyLocationSession:async()=>({ok:true,userId:'viewer',sessionId:options.newSession?'new':'viewersession',expiresAt:until})}:n.includes('resolve-user')?{resolveOrProvisionUser:async()=>({id:1})}:n.includes('verified-admission')?{resolveVerifiedAdmission:async(_,id)=>({state:options.banned===id?'blocked':'allowed'})}:n.includes('db-rate-limit')?{consumeDbRateLimit:async()=>({allowed:!options.rateLimit})}:n.includes('age-policy')?{checkAdultBirthDate:()=>({allowed:true})}:{}});
 return {writes,call:async(body={action:'distance',targetUsername:'target'})=>{const res=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)}));return {status:res.status,...await res.json()}}};
}
test('reciprocal v2 exact distances have two decimals and <=30s display lease, no coordinates',async()=>{const r=await harness().call();assert.equal(r.data.label,'0.07 miles away');assert.equal(r.data.miles,0.07);assert.ok(Date.parse(r.data.expiresAt)<=Date.now()+30000);assert.equal(r.data.latitude,undefined)});
test('legacy, expired, revoked, different sign-in and wrong-version grants never disclose exact distance',async()=>{for(const o of [{legacy:'viewer'},{legacy:'target'},{revoked:'target'},{expired:'target'},{newSession:true},{version:1}]){const r=await harness(o).call();assert.equal(r.data.miles,undefined);assert.equal(r.data.kind,'unavailable');assert.equal(r.data.band,undefined)}});
test('blocks, private targets, minors, bans and rate limiting fail closed',async()=>{for(const o of [{block:true},{private:true},{minor:'target'},{minor:'viewer'},{banned:'target'},{rateLimit:true}]){const r=await harness(o).call();assert.equal(r.data?.miles,undefined);assert.notEqual(r.data?.kind,'distance')}});
test('revoke deletes precise consent and presence, including blocked adults',async()=>{const h=harness({banned:'viewer'});assert.equal((await h.call({action:'revoke'})).ok,true);assert.deepEqual(h.writes.map(x=>x.table),['member_exact_distance_consent','member_proximity_presence'])});
test('only explicit version 2 consent records the server-verified session',async()=>{const h=harness();assert.equal((await h.call({action:'consentExact',expectedAuthId:'viewer',expectedSessionId:'viewersession',consentVersion:1})).status,403);assert.equal(h.writes.length,0);assert.equal((await h.call({action:'consentExact',expectedAuthId:'viewer',expectedSessionId:'viewersession',consentVersion:2,sessionId:'attacker'})).ok,true);assert.equal(h.writes[0].value.session_id,'viewersession')});

test('publishes precise snapshots only with explicit v2 request and live matching consent',async()=>{
 for(const [options,version,expected] of [[{},2,'viewersession'],[{},undefined,null]]) {
  const h=harness(options);const r=await h.call({action:'publish',observedAt:new Date().toISOString(),latitude:40.000123,longitude:-74,shareUntil:new Date(Date.now()+30000).toISOString(),exactDistanceVersion:version,expectedAuthId:'viewer',expectedSessionId:options.newSession?'new':'viewersession'});
  assert.equal(r.ok,true);const row=h.writes.find(w=>w.table==='member_proximity_presence').value;
  assert.equal(row.exact_session_id,expected);assert.equal(row.latitude,expected?40.00012:40);
 }
});

test('exact grant/revoke reject wrong account and grant rejects changed sign-in', async()=>{
 for (const body of [{action:'consentExact',consentVersion:2},{action:'revokeExact'},
  {action:'consentExact',consentVersion:2,expectedAuthId:'other',expectedSessionId:'viewersession'},
  {action:'consentExact',consentVersion:2,expectedAuthId:'viewer',expectedSessionId:'other'}]) {
 const h=harness();assert.equal((await h.call(body)).status,409);assert.equal(h.writes.length,0);
 }
});

test('precise publishes reject stale account or sign-in before writing',async()=>{for(const expectedSessionId of [undefined,'old-signin']){const h=harness();assert.equal((await h.call({action:'publish',exactDistanceVersion:2,expectedAuthId:'viewer',expectedSessionId})).status,409);assert.equal(h.writes.length,0)}});

test('only two independently valid legacy snapshots produce coarse distance',async()=>{
 const r=await harness({bothLegacy:true}).call();assert.equal(r.data.band,'under_1');assert.equal(r.data.miles,undefined);
});
test('missing invalid ancient and future v2 observations disclose no distance',async()=>{
 for(const observation of [null,'invalid',new Date(Date.now()-900001).toISOString(),new Date(Date.now()+6000).toISOString()]) {
 const r=await harness({observation}).call();assert.equal(r.data.kind,'unavailable');assert.equal(r.data.band,undefined);
 }
});
test('v2 publishes reject missing ancient future replayed observations and absent consent',async()=>{
 const base={action:'publish',latitude:40,longitude:-74,shareUntil:new Date(Date.now()+30000).toISOString(),exactDistanceVersion:2,expectedAuthId:'viewer',expectedSessionId:'viewersession'};
 for(const observedAt of [undefined,'invalid',new Date(Date.now()-61000).toISOString(),new Date(Date.now()+6000).toISOString()]) {
 const h=harness();assert.equal((await h.call({...base,observedAt})).status,400);assert.equal(h.writes.length,0);
 }
 const observation=new Date().toISOString();const h=harness({observation});assert.equal((await h.call({...base,observedAt:observation})).status,409);assert.equal(h.writes.length,0);
 const absent=harness({legacy:'viewer'});assert.equal((await absent.call({...base,observedAt:observation})).status,403);assert.equal(absent.writes.length,0);
});

test('precise retention starts at original observation, not publish time',async()=>{
 const observedAt=new Date(Date.now()-45000).toISOString();
 const h=harness({leaseMs:3600000,observation:new Date(Date.now()-50000).toISOString()});
 const r=await h.call({action:'publish',observedAt,latitude:40,longitude:-74,shareUntil:new Date(Date.now()+3600000).toISOString(),exactDistanceVersion:2,expectedAuthId:'viewer',expectedSessionId:'viewersession'});
 assert.equal(r.ok,true);const row=h.writes.find(x=>x.table==='member_proximity_presence').value;
 assert.equal(row.exact_observed_at,observedAt);assert.equal(Date.parse(row.share_until),Date.parse(observedAt)+900000);assert.equal(r.data.sharedUntil,row.share_until);
});
