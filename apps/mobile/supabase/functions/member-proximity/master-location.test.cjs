const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function harness(masters) {
 let handler;const reads=[];
 const db={from:table=>{
  const filters={};const q={select:()=>q,eq:(key,value)=>{filters[key]=value;return q;},gt:()=>q,
   maybeSingle:async()=>{
    reads.push({table,filters:{...filters}});
    if(table==='users') return {data:{id:2,auth_id:'target',username:'target',is_private:false}};
    if(table==='blocks') return {data:null};
    if(table==='identity_verifications') return {data:{status:'passed',date_of_birth:'1990-01-01'}};
    if(table==='member_map_settings') return masters[filters.user_id]===undefined?{data:null}:{data:{location_enabled:masters[filters.user_id]}};
    if(table==='member_proximity_presence') return {data:{latitude:40,longitude:-74,share_until:new Date(Date.now()+60000).toISOString()}};
    throw new Error(table);
   }};return q;
 }};
 const source=ts.transpileModule(fs.readFileSync(__dirname+'/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports:{},Response,console,
  Deno:{env:{get:()=> 'test'},serve:fn=>handler=fn},
  require:name=>name.includes('supabase-js')?{createClient:()=>db}
  :name.includes('verify-session')?{verifySessionDetailed:async()=>({ok:true,userId:'viewer'})}
  :name.includes('resolve-user')?{resolveOrProvisionUser:async()=>({id:1,auth_id:'viewer'})}
  :name.includes('verified-admission')?{resolveVerifiedAdmission:async()=>({state:'allowed'})}
  :name.includes('db-rate-limit')?{consumeDbRateLimit:async()=>({allowed:true})}
  :name.includes('age-policy')?{checkAdultBirthDate:()=>({allowed:true})}:{},
 });
 return {reads,call:async()=>(await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({action:'distance',targetUsername:'target'})}))).json()};
}
test('pre-migration legacy point cannot bypass missing or disabled overall master',async()=>{
 for(const masters of [{},{viewer:true},{viewer:true,target:false},{viewer:false,target:true}]) {
  const h=harness(masters);const response=await h.call();assert.equal(response.data.kind,'unavailable');
  assert.equal(h.reads.some(r=>r.table==='member_proximity_presence'),false);
 }
});
test('both overall grants permit separately consented distance-band path',async()=>{
 const h=harness({viewer:true,target:true});const response=await h.call();
 assert.equal(response.data.kind,'distance');assert.equal(response.data.band,'under_1');
 assert.equal(h.reads.filter(r=>r.table==='member_proximity_presence').length,2);
});
