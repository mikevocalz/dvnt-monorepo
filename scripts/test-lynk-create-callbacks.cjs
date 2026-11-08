#!/usr/bin/env node
/** Executes the native creation callback and discovery API with synthetic boundaries. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function expression(file, find) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let match;
  function walk(node) { if (find(node, source)) match = node; ts.forEachChild(node, walk); }
  walk(source); assert.ok(match, file);
  let text = ts.isVariableDeclaration(match) ? (ts.isCallExpression(match.initializer) ? match.initializer.arguments[0] : match.initializer).getText(source) : ts.isFunctionDeclaration(match) ? match.getText(source) : `async function ${match.name.getText(source)}${match.getText(source).slice(match.getText(source).indexOf('('))}`;
  return ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, '');
}
function loadPolicy(relative = "packages/app/features/sneaky-lynk/create-room-policy.ts") {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module','exports',js)(mod,mod.exports);return mod.exports;
}
(async () => {
  const callback = expression('packages/app/features/routes/screens/(protected)/sneaky-lynk/create.tsx', (node, source) => ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleCreate');
  const apiCalls=[],history=[],routes=[],errors=[],busy=[],toasts=[];
  let finish;
  const lifetime={active:true,epoch:0};
  const scope = {
    title:'Private audio',description:'Small group',hasVideo:false,isPublic:false,appOnly:true,
    invitees:[{authId:'guest-one'},{authId:'guest-two'}],authUser:{id:'owner',username:'host'},
    creatingRef:{current:false},captureOwner:()=>{const epoch=lifetime.epoch;return()=>lifetime.active&&lifetime.epoch===epoch;},
    setIsCreating:value=>busy.push(value),setCreateError:value=>errors.push(value),showToast:(...args)=>toasts.push(args),
    addRoom:room=>history.push(room),router:{replace:route=>routes.push(route)},
    sneakyLynkApi:{createRoom:params=>{apiCalls.push(params);return new Promise(resolve=>finish=resolve);}},
    ...loadPolicy(),console:{error(){}},
  };
  const nativeCreate = new Function(...Object.keys(scope),`return ${callback}`)(...Object.values(scope));
  const create=()=>nativeCreate(scope.captureOwner());
  const first=create();await create();assert.equal(apiCalls.length,1,'native same-tick presses cannot create two rooms');
  assert.deepEqual(apiCalls[0].invitedUserIds,['guest-one','guest-two']);assert.equal(apiCalls[0].appOnly,true);
  finish({ok:false,error:{message:'Network unavailable'}});await first;
  assert.equal(scope.creatingRef.current,false);assert.equal(errors.at(-1),'Network unavailable');assert.equal(busy.at(-1),false);
  const retry=create();finish({ok:true,data:{room:{id:12,uuid:'ab123456-1234-1234-1234-123456789012'}}});await retry;
  assert.equal(history[0].id,'ab123456-1234-1234-1234-123456789012');assert.equal(routes[0].params.id,history[0].id);
  assert.equal(scope.creatingRef.current,true,'successful native navigation retains the lock');await create();assert.equal(apiCalls.length,2);
  scope.creatingRef.current=false;
  const unknown=create();finish({ok:true,data:{room:{}}});await unknown;
  assert.equal(routes.length,1);assert.equal(history.length,1,'missing ID never produces a synthetic room');assert.match(errors.at(-1),/Check the Lynks tab/);
  const abandoned=create();lifetime.active=false;finish({ok:true,data:{room:{id:55}}});await abandoned;
  assert.equal(routes.length,1,'late native result cannot navigate after leaving');
  lifetime.active=true;
  const startExpression=expression('packages/app/features/routes/screens/(protected)/sneaky-lynk/create.tsx',(node,source)=>ts.isVariableDeclaration(node)&&node.name.getText(source)==='handleStart');
  let acceptVerification,starts=0;const draftRevisionRef={current:0};
  const startScope={captureOwner:scope.captureOwner,authUser:scope.authUser,draftRevisionRef,creatingRef:{current:false},guardVerified:(_,fn)=>acceptVerification=fn,handleCreate:()=>starts++};
  const start=new Function(...Object.keys(startScope),`return ${startExpression}`)(...Object.values(startScope));
  start();lifetime.epoch+=2;acceptVerification();assert.equal(starts,0,'native verification belongs to the initiating account epoch');
  start();draftRevisionRef.current++;acceptVerification();assert.equal(starts,0,'native form edits invalidate queued verification');
  start();lifetime.active=false;acceptVerification();assert.equal(starts,0,'native verification cannot complete after unmount');
  lifetime.active=true;start();acceptVerification();assert.equal(starts,1,'unchanged verified intent proceeds');
  start();const olderVerified=acceptVerification;start();const latestVerified=acceptVerification;
  latestVerified();olderVerified();latestVerified();assert.equal(starts,2,'native latest reviewed intent wins and is consumed once');
  scope.captureOwner.revoke=()=>{lifetime.active=false;lifetime.epoch++;};
  scope.captureOwner.resume=()=>{if(!lifetime.active){lifetime.active=true;lifetime.epoch++;}};
  const backExpression=expression('packages/app/features/routes/screens/(protected)/sneaky-lynk/create.tsx',(node,source)=>ts.isVariableDeclaration(node)&&node.name.getText(source)==='handleBack');
  let backs=0;const back=new Function('captureOwner','router',`return ${backExpression}`)(scope.captureOwner,{back:()=>backs++});
  start();const verifiedAfterBack=acceptVerification;back();verifiedAfterBack();assert.equal(starts,2);assert.equal(backs,1,'native Back revokes verification before unmount');
  lifetime.active=true;scope.creatingRef.current=false;const pendingBack=create();back();finish({ok:true,data:{room:{id:200}}});await pendingBack;assert.equal(routes.length,1,'native delayed API cannot navigate after Back while stack remains mounted');
  const nativeFile='packages/app/features/routes/screens/(protected)/sneaky-lynk/create.tsx';
  const source=ts.createSourceFile(nativeFile,fs.readFileSync(path.join(root,nativeFile),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let navigationEffect;function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&node.arguments[0]?.getText(source).includes('beforeRemove'))navigationEffect=node.arguments[0].getText(source);ts.forEachChild(node,visit);}visit(source);assert.ok(navigationEffect);
  const effectJS=ts.transpileModule('('+navigationEffect+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText.trim().replace(/;$/,'');
  const navigationListeners={};const navigation={addListener:(name,fn)=>{navigationListeners[name]=fn;return()=>delete navigationListeners[name];},isFocused:()=>true};
  const effect=new Function('navigation','captureOwner','creatingRef','setIsCreating',`return ${effectJS}`)(navigation,scope.captureOwner,scope.creatingRef,()=>{});
  scope.captureOwner.resume();const oldFocusGuard=scope.captureOwner();const clean=effect();navigationListeners.beforeRemove();assert.equal(oldFocusGuard(),false);
  navigationListeners.focus();assert.equal(oldFocusGuard(),false,'native focus starts a new lifetime and never revives old work');const newFocusGuard=scope.captureOwner();assert.equal(newFocusGuard(),true);navigationListeners.blur();assert.equal(newFocusGuard(),false);clean();assert.deepEqual(navigationListeners,{});
  const cleanNavigation=effect();navigationListeners.focus();
  scope.router.replace=route=>{routes.push(route);navigationListeners.beforeRemove();navigationListeners.blur();};
  const errorsBeforeSuccess=errors.filter(Boolean).length;
  const intentionalNavigation=create();finish({ok:true,data:{room:{id:201}}});await intentionalNavigation;
  assert.equal(routes.length,2,'intentional successful room navigation remains successful when native removal/blur fire');assert.equal(errors.filter(Boolean).length,errorsBeforeSuccess);cleanNavigation();
  const getRoomsExpression=expression('packages/app/features/sneaky-lynk/api/supabase.ts',(node,source)=>ts.isMethodDeclaration(node)&&node.name.getText(source)==='getLiveRooms');
  let response={ok:false,error:{message:'edge unavailable'}},fallbackCalls=0,lastBody;
  const getRooms=new Function('callEdgeFunction','supabase','console',`return ${getRoomsExpression}`)(async(name,body)=>{lastBody=body;return response;},{from:()=>{fallbackCalls++;throw Error('No SQL fallback allowed');}},{warn(){},error(){}});
  await assert.rejects(getRooms(),/Lynks could not be loaded/,'failed authorized list must surface a visible error');
  assert.deepEqual(lastBody,{discoveryVersion:2});assert.equal(fallbackCalls,0,'unverified SQL must never replace authoritative discovery');
  response={ok:true,data:{rooms:[]}};assert.deepEqual(await getRooms(),[],'authorized empty response remains empty');
  response={ok:true,data:{rooms:[{id:'legacy'}]}};await assert.rejects(getRooms(),/Lynks could not be loaded/,'old discovery contract fails visibly');
  response={ok:true,data:{rooms:[{id:'verified',availability:'inactive',presenceKnown:true,isOwner:true,isInvited:false,observedAt:new Date().toISOString(),presenceExpiresAt:null,endsAt:null}]}};
  const verified=await getRooms();assert.equal(verified[0].id,'verified');assert.ok(Number.isFinite(verified[0].requestStartedAt));assert.ok(Number.isFinite(verified[0].requestStartedMonotonic));
  assert.equal(fallbackCalls,0);
  const callExpression=expression('packages/app/features/sneaky-lynk/api/supabase.ts',(node,source)=>ts.isFunctionDeclaration(node)&&node.name?.getText(source)==='callEdgeFunction');
  let finishToken,dispatches=0,valid=true;
  const callEdge=new Function('requireBetterAuthToken','supabase','console',`return ${callExpression}`)(()=>new Promise(resolve=>finishToken=resolve),{functions:{invoke:async()=>{dispatches++;return {data:{ok:true,data:{room:{id:1}}}};}}},{error(){}});
  const createApiExpression=expression('packages/app/features/sneaky-lynk/api/supabase.ts',(node,source)=>ts.isMethodDeclaration(node)&&node.name.getText(source)==='createRoom');
  const createApi=new Function('callEdgeFunction',`return ${createApiExpression}`)(callEdge);
  const pendingToken=createApi({title:'A room'},{isCurrent:()=>valid});valid=false;finishToken('fixture-token');
  assert.equal((await pendingToken).error.code,'cancelled');assert.equal(dispatches,0,'account changed during token refresh: no room API dispatch');
  assert.equal((await createApi({title:'A room'},{isCurrent:()=>false})).error.code,'cancelled');assert.equal(dispatches,0);
  valid=true;const allowed=createApi({title:'A room'},{isCurrent:()=>valid});finishToken('fixture-token');assert.equal((await allowed).ok,true);assert.equal(dispatches,1);
  const guardedList=new Function('callEdgeFunction','console',`return ${getRoomsExpression}`)(callEdge,{warn(){},error(){}});
  const beforeListDispatch=dispatches;const pendingList=guardedList({isCurrent:()=>valid});valid=false;finishToken('fixture-token');
  await assert.rejects(pendingList,/Lynks could not be loaded/);assert.equal(dispatches,beforeListDispatch,'old discovery account cannot dispatch with a new token');
  let finishListResponse;
  const delayedList=new Function('callEdgeFunction','console',`return ${getRoomsExpression}`)(()=>new Promise(resolve=>finishListResponse=resolve),{warn(){},error(){}});
  valid=true;const lateList=delayedList({isCurrent:()=>valid});valid=false;finishListResponse({ok:true,data:{rooms:[{id:'another-account-private-room'}]}});
  await assert.rejects(lateList,/Lynks could not be loaded/,'a stale response cannot enter the previous account cache');
  console.log('PASS native create callbacks: invitation payload, same-tick lock, verification intent/account/form/Back/blur guards and latest-intent-only consumption, failure/retry, UUID navigation, missing-ID safety, post-token owner checks. Discovery API: authorized list, no SQL fallback, v2 negotiation, request-start stamps, real failure, post-token and late-response ownership. No network or live mutations.');
})().catch(error=>{console.error(error);process.exitCode=1;});
