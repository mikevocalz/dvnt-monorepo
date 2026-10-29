const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Real HTTP handler, synthetic auth/provider, and a strict copy of the live
// token column names. Unknown columns fail as PostgREST does, never silently pass.
function harness({ token = {}, failRevoke = false, failLookup = false, kick = false, failLatest = false } = {}) {
  let handler, providerCalls = 0;
  const writes = [];
  const existing = { room_id: 3, user_id: 'user', token_jti: 'old-jti', is_revoked: false, revoked_at: null, issued_at: '2026-01-01T00:00:00Z', ...token };
  const columns = new Set(['room_id','user_id','token_jti','is_revoked','revoked_at','issued_at','expires_at']);
  const db = {
    rpc: async name => ({data: name === 'check_rate_limit', error: null}),
    from(table) {
      const filters = []; let op = 'select', value;
      const run = () => {
        if (table === 'video_rooms') return {data:{id:3,uuid:'room',status:'open',fishjam_room_id:'provider-room'},error:null};
        if (table === 'video_room_members') return {data:{status:'active',role:'participant'},error:null};
        if (table === 'video_room_events') return {data: op === 'select' && kick ? {created_at:'2026-01-02T00:00:00Z'} : null,error:null};
        assert.equal(table,'video_room_tokens');
        if (filters.some(([key]) => !columns.has(key)) || Object.keys(value || {}).some(key=>!columns.has(key))) return {data:null,error:{message:'column does not exist'}};
        if (op === 'update') {
          if (failRevoke) return {data:null,error:{message:'revocation unavailable'}};
          writes.push(value); return {data:null,error:null};
        }
        if (op === 'insert') {writes.push(value);return {data:null,error:null};}
        if (failLookup || (failLatest && !filters.some(([key])=>key==='token_jti'))) return {data:null,error:{message:'lookup unavailable'}};
        return {data:filters.every(([key,v])=>existing[key]===v)?existing:null,error:null};
      };
      const q={select:()=>q,eq:(key,v)=>{filters.push([key,v]);return q;},in:()=>q,order:()=>q,limit:()=>q,update:v=>{op='update';value=v;return q;},insert:v=>{op='insert';value=v;return q;},single:async()=>run(),maybeSingle:async()=>run(),then:(resolve,reject)=>Promise.resolve(run()).then(resolve,reject)};
      return q;
    },
  };
  const z={string:()=>({uuid(){return this;},optional(){return this;}}),object:()=>({safeParse:data=>({success:true,data})})};
  const source=ts.transpileModule(fs.readFileSync(__dirname+'/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports:{},Request,Response,Date,crypto:require('node:crypto').webcrypto,console:{log(){},error(){}},Deno:{env:{get:()=> 'synthetic'},serve:fn=>handler=fn},fetch:async()=>{providerCalls++;return new Response(JSON.stringify({data:{peer:{id:'peer'},token:'synthetic'}}));},require:name=>{
    if(name.includes('supabase-js'))return {createClient:()=>db};
    if(name.includes('event-access'))return {resolveEventRoomAccess:async()=>({ok:true,endsAt:null})};
    if(name.includes('verify-session'))return {verifySessionDetailed:async()=>({ok:true,userId:'user'})};
    if(name.includes('verified-admission'))return {resolveVerifiedAdmission:async()=>({state:'allowed'})};
    if(name.includes('zod'))return {z};
    throw Error(name);
  }});
  return {writes,get providerCalls(){return providerCalls;},async call(currentJti='old-jti'){return (await handler(new Request('https://test',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({roomId:'room',currentJti})}))).json();}};
}

test('live is_revoked flag blocks refresh even without a revoked_at timestamp',async()=>{
 const h=harness({token:{is_revoked:true}});assert.equal((await h.call()).ok,false);assert.equal(h.providerCalls,0);
});
test('legacy revoked_at still blocks refresh',async()=>{
 const h=harness({token:{revoked_at:'2026-01-01T00:00:00Z'}});assert.equal((await h.call()).ok,false);assert.equal(h.providerCalls,0);
});
test('successful refresh uses live is_revoked column and records revocation timestamp',async()=>{
 const h=harness();assert.equal((await h.call()).ok,true);assert.equal(h.providerCalls,1);
 const revoke=h.writes.find(x=>x.is_revoked===true);assert.ok(revoke);assert.ok(Number.isFinite(Date.parse(revoke.revoked_at)));
});
test('revocation failure fails closed before minting provider credentials',async()=>{
 const h=harness({failRevoke:true});assert.equal((await h.call()).ok,false);assert.equal(h.providerCalls,0);
});
test('current token lookup failure fails closed',async()=>{
 const h=harness({failLookup:true});assert.equal((await h.call()).ok,false);assert.equal(h.providerCalls,0);
});
test('newer kick/ban event blocks refresh using current token live schema',async()=>{
 const h=harness({kick:true});assert.equal((await h.call()).ok,false);assert.equal(h.providerCalls,0);
});
test('latest token lookup failure with a kick/ban fails closed',async()=>{
 const h=harness({kick:true,failLatest:true});assert.equal((await h.call()).ok,false);assert.equal(h.providerCalls,0);
});
