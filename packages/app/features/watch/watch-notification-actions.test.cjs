const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const crypto=require('node:crypto');
function harness(){
 const storage=new Map(),alerts=[],sent=[],subscriptions=[];let offline=true,user={id:'a'},gen='a';
 const exports={};
 const source=ts.transpileModule(fs.readFileSync(`${__dirname}/watch-notification-actions.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(source,{exports,console,Date,JSON,Error,require(name){
  if(name==='react-native')return{Alert:{alert:(...args)=>alerts.push(args)}};
  if(name==='expo-crypto')return{CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,text)=>crypto.createHash('sha256').update(text).digest('hex')};
  if(name.endsWith('/mmkv-zustand'))return{mmkv:{getString:k=>storage.get(k),set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)}};
  if(name.endsWith('/auth-store'))return{useAuthStore:{getState:()=>({user}),subscribe:f=>subscriptions.push(f)}};
  if(name==='./watch-session-store')return{useWatchSessionStore:{getState:()=>({accountGen:gen})}};
  if(name.endsWith('/auth/identity'))return{getCurrentUserRow:async()=>({id:1,authId:'a'})};
  if(name.endsWith('/messages-impl'))return{messagesApi:{sendMessage:async body=>{sent.push(body);if(offline)throw Error('offline');return{id:'42'};},markAsRead:async()=>({ok:!offline})}};
  throw Error(name);
 }});
 return{api:exports,alerts,sent,storage,online:()=>offline=false,switchAccount:()=>{const previous={user};user={id:'b'};gen='b';subscriptions.forEach(f=>f({user},previous));}};
}
function response(){return{actionIdentifier:'DVNT_REPLY',userText:'Hello',notification:{request:{identifier:'notification-1',content:{data:{conversationId:'7',recipientAuthId:'a',issuedAt:Date.now()/1000}}}}};}
test('offline reply is persisted and explicit restored retry uses the same operation ID',async()=>{
 const h=harness();assert.equal(await h.api.handleWatchNotificationAction(response()),true);
 assert.equal(JSON.parse(h.storage.values().next().value).length,1);
 h.alerts.length=0;h.api.restoreWatchNotificationActions();assert.equal(h.alerts.length,1);
 h.online();h.alerts[0][2][1].onPress();await new Promise(r=>setImmediate(r));
 assert.equal(h.sent.length,2);assert.equal(h.sent[0].operationId,h.sent[1].operationId);
 assert.equal(JSON.parse(h.storage.values().next().value).length,0);
});
test('account change erases pending text and prevents a stale alert retry from sending',async()=>{
 const h=harness();await h.api.handleWatchNotificationAction(response());const retry=h.alerts.at(-1)[2][1];
 h.switchAccount();assert.equal(h.storage.size,0);h.online();retry.onPress();await new Promise(r=>setImmediate(r));assert.equal(h.sent.length,1);
});
test('expired recipient notification cannot issue a write',async()=>{
 const h=harness(),r=response();r.notification.request.content.data.issuedAt-=86401;
 await h.api.handleWatchNotificationAction(r);assert.equal(h.sent.length,0);
});
