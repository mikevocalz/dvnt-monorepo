const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(platform='ios') {
  let user={id:'account-a'}, generation='gen-a';
  const authListeners=[], listeners=new Map(), contexts=[], queued=[], responses=[];
  const add=(event,fn)=>{const set=listeners.get(event)||new Set();set.add(fn);listeners.set(event,set);return()=>set.delete(fn);};
  const native={watchEvents:{addListener:add},getReachability:async()=>true,updateApplicationContext:ctx=>contexts.push(ctx),transferUserInfo:body=>queued.push(body),sendMessage:()=>{}};
  const wear={syncContext:async json=>{contexts.push(JSON.parse(json));return true;},syncTickets:async()=>true,isWearAppAvailable:async()=>true,sendResponse:async(node,id,json)=>responses.push(JSON.parse(json)),broadcastEvent:async()=>true};
  const settings={enabled:true,tickets:true,messages:true,calls:true,broadcasts:true,door:true};
  const evaluate=(file,require)=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/${file}`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require,console,Date,Map,Set,Promise});return exports;};
  const contracts=evaluate('contracts/v2.ts',()=>{throw Error('unexpected contract import');});
  const api=evaluate('watch-bridge.ts',name=>{
    if(name==='react-native')return{Platform:{OS:platform},NativeModules:{DVNTWearBridge:wear},NativeEventEmitter:class{addListener(e,f){return{remove:add(e,f)}}}};
    if(name==='react-native-watch-connectivity')return native;
    if(name==='@bacons/apple-targets')return{};
    if(name==='./contracts/v2')return contracts;
    if(name==='./watch-settings-store')return{watchFeatureEnabled:key=>settings.enabled&&settings[key],useWatchSettingsStore:{getState:()=>({...settings,set:(key,value)=>settings[key]=value})}};
    if(name.endsWith('/auth-store'))return{useAuthStore:{getState:()=>({user}),subscribe:fn=>{authListeners.push(fn);return()=>{};}}};
    if(name==='./watch-session-store')return{useWatchSessionStore:{getState:()=>({accountGen:generation,selectAccount:id=>{generation=id==='account-a'?'gen-a':'gen-b';return generation;}})}};
    throw Error(name);
  });
  const emit=async(message)=>{if(platform==='android'){await Promise.all([...listeners.get('DVNTWearMessage')||[]].map(f=>f({nodeId:'watch',requestId:'request',payload:JSON.stringify(message)})));await new Promise(r=>setImmediate(r));return;}const replies=[];await Promise.all([...listeners.get('message')||[]].map(f=>f(message,r=>replies.push(r))));return replies;};
  return{api,contexts,queued,responses,emit,listeners,wear,switchAccount:()=>{const previous={user};user={id:'account-b'};authListeners.forEach(fn=>fn({user},previous));}};
}
const command=()=>({protocol:2,accountGen:'gen-a',operationId:'a20f6049-ab0f-49d2-8621-232571c4eed9',type:'dmReply',conversationId:'1',text:'Hello',issuedAt:Date.now()/1000,expiresAt:Date.now()/1000+60});

test('one request owner replies even when multiple watch handlers are mounted',async()=>{
  const h=harness();h.api.registerWatchRequestHandler({tickets:()=>({tickets:[],syncedAt:1})});h.api.registerWatchRequestHandler({dms:()=>null});h.api.registerWatchDMReplyHandler(()=>[],async()=>{throw Error('wrong dispatch');});
  const replies=await h.emit({type:'requestTickets'});assert.equal(replies.length,1);assert.equal(JSON.parse(replies[0].session).accountGen,'gen-a');
});
test('concurrent duplicate sends wait for one authoritative backend result',async()=>{
  const h=harness();let calls=0,resolve;h.api.registerWatchDMReplyHandler(()=>['1'],()=>{calls++;return new Promise(r=>resolve=r);});
  const c=command();let completed=false;const first=h.emit(c).then(r=>{completed=true;return r;});const second=h.emit(c);await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(completed,false);resolve('42');
  for(const replies of [await first,await second])assert.equal(JSON.parse(replies[0].commandResult).serverId,'42');
});
test('late backend result cannot publish into another account',async()=>{
  const h=harness();let resolve;h.api.registerWatchDMReplyHandler(()=>['1'],()=>new Promise(r=>resolve=r));const pending=h.emit(command());h.switchAccount();resolve('42');assert.equal((await pending).length,0);assert.equal(h.queued.some(x=>x.commandResult),false);assert.deepEqual(JSON.parse(h.contexts.at(-1).dms).dms,[]);
});
test('merged snapshots keep independent domains and unsubscribe uses native function form',async()=>{
  const h=harness();await h.api.syncTicketsToWatch({protocol:2,accountGen:'gen-a',tickets:[{id:'pass'}],syncedAt:1});await h.api.syncDMsToWatch({protocol:2,accountGen:'gen-a',dms:[{id:'1'}],syncedAt:2});const ctx=h.contexts.at(-1);assert.equal(JSON.parse(ctx.payload).tickets[0].id,'pass');assert.equal(JSON.parse(ctx.dms).dms[0].id,'1');const off=h.api.registerWatchRequestHandler({dms:()=>null});off();assert.equal(h.listeners.get('message').size,0);
});
test('Wear command replies use MessageClient response, same backend result contract',async()=>{
  const h=harness('android');h.api.registerWatchDMReplyHandler(()=>['1'],async()=> '88');await h.emit(command());assert.equal(h.responses.length,1);assert.equal(JSON.parse(h.responses[0].commandResult).serverId,'88');
});

test('a delayed old-account summary cannot be restamped as the current account',async()=>{
  const h=harness();h.switchAccount();await new Promise(r=>setImmediate(r));const before=h.contexts.length;
  await h.api.syncDMsToWatch({protocol:2,accountGen:'gen-a',dms:[{id:'private-a'}],syncedAt:Date.now()/1000});
  assert.equal(h.contexts.length,before);assert.deepEqual(JSON.parse(h.contexts.at(-1).dms).dms,[]);
});

test('Android account reset still publishes composite clear after ticket transport failure',async()=>{
  const h=harness('android');h.wear.syncTickets=async()=>{throw Error('offline');};
  await h.api.clearWatchAccount('gen-a');assert.ok(h.contexts.length);
  assert.deepEqual(JSON.parse(h.contexts.at(-1).dms).dms,[]);
});
test('all public snapshot publishers reject a retired generation',async()=>{
  const h=harness();h.switchAccount();await new Promise(r=>setImmediate(r));const before=h.contexts.length;
  for(const [method,body] of [['syncTicketsToWatch',{tickets:[{id:'secret'}]}],['syncBroadcastsToWatch',{broadcasts:[{id:'secret'}]}],['syncDoorToWatch',{door:{eventId:'secret'}}]]) {
    await h.api[method]({protocol:2,accountGen:'gen-a',syncedAt:1,...body});
  }
  assert.equal(h.contexts.length,before);
});
test('Wear receives live thread pages through event transport',async()=>{
  const h=harness('android');const sent=[];h.wear.broadcastEvent=async json=>{sent.push(JSON.parse(json));return true;};
  await h.api.pushWatchThreadPage({protocol:2,accountGen:'gen-a',conversationId:'1',messages:[],olderCursor:null});
  assert.equal(sent.length,1);assert.equal(JSON.parse(sent[0].threadPage).conversationId,'1');
});

test('call action acknowledgment waits for backend acceptance and shares concurrent result',async()=>{
  const h=harness();let resolve,calls=0;h.api.registerWatchCallHandler(()=>{calls++;return new Promise(r=>resolve=r);});
  const c={...command(),type:'callAction',callId:'call-1',action:'accept',expectedStatus:'ringing',expiresAt:Date.now()/1000+25};
  let completed=false;const first=h.emit(c).then(r=>{completed=true;return r;});const second=h.emit(c);
  await new Promise(r=>setImmediate(r));assert.equal(completed,false);assert.equal(calls,1);
  resolve(false);assert.equal((await first)[0].ok,false);assert.equal((await second)[0].ok,false);
});

test('disabled calls reject instead of acknowledging a dropped action',async()=>{
 const h=harness();let calls=0;h.api.registerWatchCallHandler(()=>{calls++;return true;});await h.api.setWatchFeature('calls',false);
 const replies=await h.emit({...command(),type:'callAction',callId:'call-1',action:'decline',expectedStatus:'ringing',expiresAt:Date.now()/1000+25});
 assert.equal(replies[0].ok,false);assert.equal(calls,0);
});
test('Door request refresh has one owner and returns the scoped snapshot',async()=>{
 const h=harness();let refreshes=0;h.api.registerWatchDoorHandler(async()=>{refreshes++;});h.api.registerWatchRequestHandler({tickets:()=>null});
 await h.api.syncDoorToWatch({protocol:2,accountGen:'gen-a',door:{eventId:'9'},status:'ready',syncedAt:1});
 const replies=await h.emit({type:'requestDoor'});assert.equal(replies.length,1);assert.equal(refreshes,1);assert.equal(JSON.parse(replies[0].door).door.eventId,'9');
});
