const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const crypto=require('node:crypto');
function harness(){
 const storage=new Map(),alerts=[],sent=[],subscriptions=[];let offline=true,noConfirmation=false,user={id:'a'},gen='a',authStatus='authenticated',isAuthenticated=true,identityWait=null;
 const exports={};
 const source=ts.transpileModule(fs.readFileSync(`${__dirname}/watch-notification-actions.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(source,{exports,console,Date,JSON,Error,require(name){
  if(name==='react-native')return{Alert:{alert:(...args)=>alerts.push(args)}};
  if(name==='expo-crypto')return{CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,text)=>crypto.createHash('sha256').update(text).digest('hex')};
  if(name.endsWith('/mmkv-zustand'))return{mmkv:{getString:k=>storage.get(k),set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)}};
  if(name.endsWith('/auth-store'))return{useAuthStore:{getState:()=>({user,authStatus,isAuthenticated}),subscribe:f=>subscriptions.push(f)}};
  if(name==='./watch-session-store')return{useWatchSessionStore:{getState:()=>({accountGen:gen})}};
  if(name.endsWith('/auth/identity'))return{getCurrentUserRow:async()=>{if(identityWait)await identityWait;return{id:1,authId:'a'};}};
  if(name.endsWith('/messages-impl'))return{messagesApi:{reactToMessage:async(messageId,emoji,options)=>{sent.push({messageId,emoji,options});if(offline)throw Error('offline');},sendMessage:async body=>{sent.push(body);if(offline)throw Error('offline');return noConfirmation?undefined:{id:'42'};},markAsRead:async()=>({ok:!offline})}};
  throw Error(name);
 }});
 return{api:exports,alerts,sent,storage,pauseIdentity:()=>{let release;identityWait=new Promise(resolve=>release=resolve);return()=>{identityWait=null;release();};},authLoading:()=>{authStatus='loading';isAuthenticated=false;},authReady:()=>{authStatus='authenticated';isAuthenticated=true;},online:()=>offline=false,withoutConfirmation:()=>{offline=false;noConfirmation=true;},switchAccount:()=>{const previous={user};user={id:'b'};gen='b';subscriptions.forEach(f=>f({user},previous));}};
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
test('heart category registers a desired-state action and rejects missing message identity',async()=>{
 const h=harness(),categories=[];
 await h.api.registerWatchNotificationCategories({setNotificationCategoryAsync:async(...args)=>categories.push(args)});
 assert.ok(categories.find(c=>c[0]==='DVNT_MESSAGE')[1].some(a=>a.identifier==='DVNT_HEART'));
 const r=response();r.actionIdentifier='DVNT_HEART';
 assert.equal(await h.api.handleWatchNotificationAction(r),true);
 assert.equal(JSON.parse(h.storage.values().next().value).length,0);assert.equal(h.alerts[0][0],'Message unavailable');
});
test('heart retry requests present=true instead of toggling a confirmed reaction away',async()=>{
 const h=harness(),r=response();r.actionIdentifier='DVNT_HEART';r.notification.request.content.data.messageId='42';
 await h.api.handleWatchNotificationAction(r);h.online();h.api.restoreWatchNotificationActions();
 h.alerts.at(-1)[2][1].onPress();await new Promise(r=>setImmediate(r));
 assert.equal(h.sent.length,2);
 assert.equal(h.sent[0].messageId,'42');assert.equal(h.sent[0].emoji,'❤️');
 assert.equal(h.sent[0].options.desiredPresent,true);assert.equal(h.sent[1].options.desiredPresent,true);
 assert.equal(JSON.parse(h.storage.values().next().value).length,0);
});
test('a heart action does not replace an uncertain reply to the same notification',async()=>{
 const h=harness(),reply=response(),heart=response();heart.actionIdentifier='DVNT_HEART';heart.notification.request.content.data.messageId='42';
 await h.api.handleWatchNotificationAction(reply);await h.api.handleWatchNotificationAction(heart);
 assert.equal(JSON.parse(h.storage.values().next().value).length,2);
 h.online();await h.api.handleWatchNotificationAction(heart);
 const remaining=JSON.parse(h.storage.values().next().value);
 assert.equal(remaining.length,1);assert.equal(remaining[0].response.actionIdentifier,'DVNT_REPLY');
});
test('event action uses the validated event handler and retains operation identity on explicit retry',async()=>{
 const h=harness(),commands=[],r=response();r.actionIdentifier='DVNT_GOING';r.notification.request.content.data.eventId='9';
 h.api.registerWatchNotificationEventHandler(async c=>{commands.push(c);return {...c,status:commands.length===1?'failed':'confirmed'};});
 await h.api.handleWatchNotificationAction(r);await h.api.handleWatchNotificationAction(r);
 assert.equal(commands.length,2);assert.equal(commands[0].action,'going');assert.equal(commands[0].eventId,'9');
 assert.equal(commands[0].operationId,commands[1].operationId);assert.equal(commands[0].accountGen,'a');
});
test('call notification action expires instead of entering the persistent retry queue',async()=>{
 const h=harness(),calls=[],r=response();r.actionIdentifier='DVNT_CALL_AUDIO';r.notification.request.content.data.roomId='room';
 h.api.registerWatchNotificationCallHandler(async(...args)=>{calls.push(args);return true;});
 await h.api.handleWatchNotificationAction(r);assert.equal(calls.length,1);assert.equal(calls[0][1],'accept_audio_only');assert.equal(h.storage.size,0);
 r.notification.request.content.data.issuedAt-=31;await h.api.handleWatchNotificationAction(r);assert.equal(calls.length,1);
});
test('host action routes only after matching notification recipient',async()=>{
 const h=harness(),routes=[],r=response();r.actionIdentifier='DVNT_OPEN_HOST';r.notification.request.content.data.eventId='9';
 await h.api.handleWatchNotificationAction(r,route=>routes.push(route));assert.equal(routes[0],'/(protected)/events/9/scanner');
 r.notification.request.content.data.recipientAuthId='someone-else';await h.api.handleWatchNotificationAction(r,route=>routes.push(route));assert.equal(routes.length,1);
});

test('reply remains recoverable when API resolves without a server message ID',async()=>{
 const h=harness();h.withoutConfirmation();await h.api.handleWatchNotificationAction(response());
 assert.equal(JSON.parse(h.storage.values().next().value).length,1);
 assert.equal(h.alerts.at(-1)[0],'Couldn’t confirm');
});
test('Show pass notification opens the addressed event pass',async()=>{
 const h=harness(),r=response(),routes=[];r.actionIdentifier='DVNT_OPEN_TICKET';r.notification.request.content.data.eventId='19';
 await h.api.handleWatchNotificationAction(r,route=>routes.push(route));assert.equal(routes[0],'/(protected)/ticket/19');
});
test('non-finite notification timestamp cannot trigger a write',async()=>{
 const h=harness(),r=response();r.notification.request.content.data.issuedAt=NaN;h.online();
 await h.api.handleWatchNotificationAction(r);assert.equal(h.sent.length,0);
});
test('malformed persisted notification entries cannot crash restoration or a new action',async()=>{
 for(const corrupt of ['null','{}','[null,{},42]','not json']) {
  const h=harness();h.storage.set('watch-notification-pending-v2',corrupt);
  assert.doesNotThrow(()=>h.api.restoreWatchNotificationActions());
  await h.api.handleWatchNotificationAction(response());
  assert.equal(h.sent.length,1);
  assert.equal(JSON.parse(h.storage.get('watch-notification-pending-v2')).length,1);
 }
});

test('cold call response waits for auth and handler, then hydrates recipient-bound claim exactly once',async()=>{
 const h=harness(),r=response();r.actionIdentifier='DVNT_CALL_AUDIO';r.notification.request.content.data.roomId='cold-room';
 let cleared=0;const consume=()=>h.api.consumeWatchNotificationResponse(r,()=>assert.fail('generic navigation'),async()=>{cleared++;});
 h.authLoading();assert.equal(await consume(),'deferred');assert.equal(cleared,0);assert.equal(h.storage.size,0);
 h.authReady();assert.equal(await consume(),'deferred');assert.equal(cleared,0);
 const helper={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/../services/callkeep/answer-call.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:helper,Date});
 let ready=0,fetches=0,claims=0,confirm;
 const unsubscribe=h.api.subscribeWatchNotificationReadiness(()=>ready++);
 const signal={id:22,room_id:'cold-room',callee_id:1,status:'ringing',call_type:'video',created_at:new Date().toISOString()};
 h.api.registerWatchNotificationCallHandler(async(roomId,action)=>{
  assert.equal(action,'accept_audio_only');
  const result=await helper.answerIncomingCall({roomId,calleeId:'1',current:()=>true,
   fetchSignal:async(room,callee)=>{fetches++;assert.equal(room,'cold-room');assert.equal(callee,'1');return signal;},
   claim:async(id,callee,room)=>{claims++;assert.equal(id,22);assert.equal(callee,'1');assert.equal(room,'cold-room');return new Promise(resolve=>confirm=resolve);}});
  return !!result;
 });
 assert.equal(ready,1);unsubscribe();
 const first=consume(),duplicate=consume();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(fetches,1);assert.equal(claims,1);assert.equal(cleared,0);
 confirm(true);assert.equal(await first,'handled');assert.equal(await duplicate,'handled');assert.equal(cleared,1);assert.equal(h.storage.size,0);
});
test('deferred cold call expires while auth is loading without replay queue or later action',async()=>{
 const h=harness(),r=response();r.actionIdentifier='DVNT_CALL_ACCEPT';r.notification.request.content.data.roomId='cold-room';
 h.authLoading();let cleared=0;
 assert.equal(await h.api.consumeWatchNotificationResponse(r,()=>{},async()=>{cleared++;}),'deferred');
 r.notification.request.content.data.issuedAt-=31;
 assert.equal(await h.api.consumeWatchNotificationResponse(r,()=>{},async()=>{cleared++;}),'handled');
 assert.equal(cleared,1);assert.equal(h.storage.size,0);
 let calls=0;h.authReady();h.api.registerWatchNotificationCallHandler(async()=>{calls++;return true;});
 await h.api.handleWatchNotificationAction(r);assert.equal(calls,0);
});
test('events also preserve the original response while their protected handler initializes',async()=>{
 const h=harness(),r=response();r.actionIdentifier='DVNT_GOING';r.notification.request.content.data.eventId='9';let cleared=0;
 assert.equal(await h.api.consumeWatchNotificationResponse(r,()=>{},async()=>{cleared++;}),'deferred');assert.equal(h.storage.size,0);
 h.api.registerWatchNotificationEventHandler(async command=>({...command,status:'confirmed'}));
 assert.equal(await h.api.consumeWatchNotificationResponse(r,()=>{},async()=>{cleared++;}),'handled');assert.equal(cleared,1);
});

test('handler unmount during identity resolution defers instead of consuming the call',async()=>{
 const h=harness(),r=response();r.actionIdentifier='DVNT_CALL_ACCEPT';r.notification.request.content.data.roomId='cold-room';
 let calls=0,cleared=0;const unregister=h.api.registerWatchNotificationCallHandler(async()=>{calls++;return true;});
 const resume=h.pauseIdentity();const pending=h.api.consumeWatchNotificationResponse(r,()=>{},async()=>{cleared++;});
 await new Promise(resolve=>setImmediate(resolve));unregister();resume();
 assert.equal(await pending,'deferred');assert.equal(calls,0);assert.equal(cleared,0);assert.equal(h.storage.size,0);
 h.api.registerWatchNotificationCallHandler(async()=>{calls++;return true;});
 assert.equal(await h.api.consumeWatchNotificationResponse(r,()=>{},async()=>{cleared++;}),'handled');assert.equal(calls,1);assert.equal(cleared,1);
});
test('account change during identity resolution cannot invoke an old call handler',async()=>{
 const h=harness(),r=response();r.actionIdentifier='DVNT_CALL_DECLINE';r.notification.request.content.data.roomId='cold-room';let calls=0;
 h.api.registerWatchNotificationCallHandler(async()=>{calls++;return true;});const resume=h.pauseIdentity();
 const pending=h.api.handleWatchNotificationAction(r);await new Promise(resolve=>setImmediate(resolve));h.switchAccount();resume();
 assert.equal(await pending,true);assert.equal(calls,0);
});
