// Executes the actual store subscription body with controlled transport/auth.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(r=>setImmediate(r));
function harness({accessDeferred,authDeferred,accessFails=false,socketFails=false}={}) {
 let userId=1,epoch=0,fetches=0;const listeners=new Set(),channels=[],removed=[],warnings=[];
 const access=()=>{const start=epoch;return {userId,requestEpoch:String(epoch),assertCurrent(){if(epoch!==start||userId!==1)throw Error('account changed');}};};
 const exports={};const src=ts.transpileModule(fs.readFileSync(path.join(__dirname,'activity-store.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const create=init=>{let state;const set=p=>{state={...state,...(typeof p==='function'?p(state):p)};};const get=()=>state;state=init(set,get);return {getState:()=>state,setState:set};};
 const db={removeChannel:async c=>{removed.push(c);}};
 vm.runInNewContext(src,{exports,console:{log(){},error(){},warn:(...args)=>warnings.push(args)},require:name=>{
  if(name==='zustand')return {create};
  if(name.endsWith('/supabase/client'))return {supabase:db,ensureBridgeRealtimeAuth:async()=>authDeferred?authDeferred.promise:!socketFails};
  if(name.endsWith('/api/notification-access'))return {requireNotificationAccess:async()=>{if(accessFails)throw Error('private');const value=access();if(accessDeferred)await accessDeferred.promise;value.assertCurrent();return value;}};
  if(name.endsWith('/auth/session-lifecycle'))return {subscribeSessionLifecycle:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);}};
  if(name.endsWith('/api/auth-helper'))return {getCurrentUserIdSync:()=>userId};
  if(name.endsWith('/supabase/realtime'))return {freshChannel:topic=>{const c={topic,on(_event,filter,cb){c.filter=filter;c.event=cb;return c;},subscribe(cb){c.status=cb;return c;}};channels.push(c);return c;}};
  return {};
 }});
 exports.useActivityStore.setState({fetchFromBackend:async()=>{fetches++;}});
 return {store:exports.useActivityStore,channels,removed,warnings,listeners,get fetches(){return fetches;},switchUser(id){userId=id;epoch++;for(const fn of [...listeners])fn();}};
}
test('actual store awaits both identity and socket auth; opens only own filtered channel',async()=>{
 const identity=deferred(),socket=deferred();const h=harness({accessDeferred:identity,authDeferred:socket});const close=h.store.getState().subscribeToNotifications();
 assert.equal(h.channels.length,0);identity.resolve();await flush();assert.equal(h.channels.length,0);socket.resolve(true);await flush();
 assert.equal(h.channels.length,1);const c=h.channels[0];assert.equal(c.filter.filter,'recipient_id=eq.1');
 await c.event({new:{recipient_id:2}});assert.equal(h.fetches,0);
 await c.event({new:{recipient_id:1}});assert.equal(h.fetches,1);
 c.status('SUBSCRIBED');await flush();assert.equal(h.fetches,2);
 close();await c.event({new:{recipient_id:1}});assert.equal(h.fetches,2);assert.equal(h.removed.length,1);assert.equal(h.listeners.size,0);
});
for(const stage of ['identity','socket'])test(`cleanup while ${stage} pending creates no channel`,async()=>{
 const pending=deferred();const h=harness(stage==='identity'?{accessDeferred:pending}:{authDeferred:pending});const close=h.store.getState().subscribeToNotifications();await flush();close();pending.resolve(true);await flush();assert.equal(h.channels.length,0);assert.equal(h.listeners.size,0);
});
for(const option of [{accessFails:true},{socketFails:true}])test(`failed auth never opens anonymous channel ${JSON.stringify(option)}`,async()=>{
 const h=harness(option);h.store.getState().subscribeToNotifications();await flush();assert.equal(h.channels.length,0);assert.equal(h.listeners.size,0);assert.ok(!JSON.stringify(h.warnings).includes('private'));
});
test('account switch immediately closes old channel and rejects delayed callbacks',async()=>{
 const h=harness();h.store.getState().subscribeToNotifications();await flush();const c=h.channels[0];h.switchUser(2);await c.event({new:{recipient_id:1}});c.status('SUBSCRIBED');await flush();assert.equal(h.fetches,0);assert.equal(h.removed.length,1);
});
test('signout while socket auth pending cannot create a late channel',async()=>{
 const pending=deferred();const h=harness({authDeferred:pending});h.store.getState().subscribeToNotifications();await flush();h.switchUser(null);pending.resolve(true);await flush();assert.equal(h.channels.length,0);
 assert.equal(h.store.getState().subscribeToNotifications(),undefined);
});
