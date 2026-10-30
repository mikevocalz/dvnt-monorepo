/** Actual message API and Edge handler, with offline auth and RPC boundaries. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function loader(stubs, globals = {}) {
  const cache = new Map();
  return function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file,exports);
    const output = ts.transpileModule(fs.readFileSync(file,'utf8'), {fileName:file, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(output, {exports,console:{log(){},error(){}},...globals,require:name=>{
      if (name in stubs) return stubs[name];
      let target = name.startsWith('@dvnt/app/') ? path.join(root,'packages/app',name.slice(10)) : name.startsWith('.') ? path.resolve(path.dirname(file),name) : null;
      if (!target) throw new Error(`Unexpected import ${name}`);
      if (!fs.existsSync(target)) target += '.ts';
      return load(target);
    }}, {filename:file}); return exports;
  };
}
const plain = value => JSON.parse(JSON.stringify(value));
function apiFixture() {
  const state = {viewer:'101',epoch:0,ready:true,calls:[],token:async()=> 'fixture-token',response:{data:{ok:true,data:{reactions:[{emoji:'❤️',userId:101,username:'fixture'}],toggled:'added',present:true}},error:null}};
  const load=loader({
    '../stores/auth-store':{useAuthStore:{getState:()=>({user:{id:state.viewer}})}},
    '../auth/identity':{requireBetterAuthToken:()=>state.token(),getCurrentUserId:async()=>101},
    './auth-helper':{getCurrentUserIdSync:()=>101,getCurrentUserAuthId:async()=> 'fixture-auth',resolveUserIdInt:async()=>101},
    '../supabase/client':{supabase:{functions:{invoke:async(...args)=>{state.calls.push(plain(args));return state.response;}}}},
    '../auth/session-lifecycle':{getSessionLifecycle:()=>({epoch:state.epoch,ready:state.ready})},
  });
  return {state,api:load(path.join(root,'packages/app/lib/api/messages-impl.ts')).messagesApi};
}
test('API returns canonical reactions and forwards exact desired state with verified session token', async()=>{
  const {state,api}=apiFixture();
  const result=await api.reactToMessage('41','❤️',{desiredPresent:true,expectedViewerId:'101',expectedSessionEpoch:0});
  assert.deepEqual(plain(result),{reactions:[{emoji:'❤️',userId:'101',username:'fixture'}],toggled:'added',present:true});
  assert.deepEqual(state.calls,[['react-message',{body:{messageId:41,emoji:'❤️',desiredPresent:true},headers:{Authorization:'Bearer fixture-token'}}]]);
});
test('API rejects malformed/temp IDs, account changes during token retrieval, and missing acknowledgement',async()=>{
  for (const id of ['41junk','temp-41','0','-1','9007199254740993']) {
    const {state,api}=apiFixture();await assert.rejects(api.reactToMessage(id,'❤️'));assert.equal(state.calls.length,0);
  }
  const f=apiFixture();f.state.token=async()=>{f.state.epoch++;return 'fixture-token';};
  await assert.rejects(f.api.reactToMessage('41','❤️',{expectedViewerId:'101',expectedSessionEpoch:0}),/Account changed/);
  assert.equal(f.state.calls.length,0);
  const g=apiFixture();g.state.response={data:{ok:true},error:null};
  await assert.rejects(g.api.reactToMessage('41','❤️'),/confirm reaction/);
});
test('API refuses reactions before session readiness and if readiness changes during token retrieval', async()=>{
  const f=apiFixture();
  f.state.ready=false;
  let tokenCalls=0;
  f.state.token=async()=>{tokenCalls++;return 'fixture-token';};
  await assert.rejects(f.api.reactToMessage('41','❤️',{expectedViewerId:'101',expectedSessionEpoch:0}),/Account changed/);
  assert.equal(tokenCalls,0);
  assert.equal(f.state.calls.length,0);
  const g=apiFixture();
  g.state.token=async()=>{g.state.ready=false;return 'fixture-token';};
  await assert.rejects(g.api.reactToMessage('41','❤️',{expectedViewerId:'101',expectedSessionEpoch:0}),/Account changed/);
  assert.equal(g.state.calls.length,0);
});
function edgeFixture() {
  const state={session:{ok:true,userId:'verified-fixture'},calls:[],result:{data:{ok:true,reactions:[],present:false,toggled:'removed'},error:null}};
  let handler;
  const admin={rpc:async(...args)=>{state.calls.push(plain(args));return state.result;}};
  const load=loader({
    'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>admin},
    '../_shared/verify-session.ts':{verifySessionDetailed:async()=>state.session},
    '../_shared/resolve-user.ts':{resolveOrProvisionUser:async()=>({id:101,username:'fixture'})},
  },{Response,Deno:{env:{get:()=> 'fixture-only'},serve:fn=>{handler=fn;}}});
  load(path.join(root,'apps/mobile/supabase/functions/react-message/index.ts'));
  return {state,call:async(body,token='fixture-token')=> (await handler(new Request('https://fixture.invalid/react-message',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)}))).json()};
}
test('Edge passes only verified identity and explicit desired-state to atomic RPC',async()=>{
  const {state,call}=edgeFixture();
  assert.equal((await call({messageId:41,emoji:'❤️',desiredPresent:false,authUserId:'forged'})).ok,true);
  assert.deepEqual(state.calls,[['set_message_reaction',{p_message_id:41,p_auth_id:'verified-fixture',p_emoji:'❤️',p_desired_present:false}]]);
});
test('Edge rejects unauthenticated/invalid writes and fails closed on missing RPC',async()=>{
  const f=edgeFixture();f.state.session={ok:false,reason:'expired'};
  assert.equal((await f.call({messageId:41,emoji:'❤️'})).error.code,'unauthorized');assert.equal(f.state.calls.length,0);
  const g=edgeFixture();assert.equal((await g.call({messageId:'41',emoji:'❤️'})).error.code,'bad_request');assert.equal(g.state.calls.length,0);
  g.state.result={data:null,error:{code:'PGRST202'}};
  assert.equal((await g.call({messageId:41,emoji:'❤️'})).error.code,'update_failed');
});
