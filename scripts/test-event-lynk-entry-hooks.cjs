#!/usr/bin/env node
// Execute the real React hooks with synthetic API/auth boundaries. No live writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const paths = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), ROOT];
const load = n => require(require.resolve(n, {paths}));
// Dependency fixtures may symlink React Query from another install. All hooks
// and the renderer must resolve the same React instance.
const reactAliases = Object.fromEntries(['react', 'react-dom'].map(name => [name, path.dirname(require.resolve(`${name}/package.json`, { paths }))]));
(async () => {
 const boundaries = new Map([
  ['fixture', `import {useSyncExternalStore} from 'react';
   let auth={user:{id:'host-a'},isAuthenticated:true};const listeners=new Set();const sessionListeners=new Set();let session={epoch:1,ready:true};
   export const f=window.fixture={calls:0,startArgs:[],navigations:[],errors:[],epoch:1,holdLists:false,listPending:[],pending:[],lists:[],eventId:'42',roomId:'room-42',mayHost:true,
    boundary(ready=true){f.epoch++;session={epoch:f.epoch,ready};for(const l of [...sessionListeners])l();},
    setAuth(id){auth={user:id?{id}:null,isAuthenticated:!!id};for(const l of [...listeners])l();},
    start(){f.calls++;return new Promise((resolve,reject)=>f.pending.push({resolve,reject}));}};
   export const useAuthStore=select=>select(useSyncExternalStore(l=>{listeners.add(l);return()=>listeners.delete(l)},()=>auth));
   useAuthStore.getState=()=>auth;
   export const getSessionLifecycle=()=>session;
   export const subscribeSessionLifecycle=l=>{sessionListeners.add(l);return()=>sessionListeners.delete(l);};
   export const eventLynkApi={start:(eventId,roomId)=>{f.startArgs.push({eventId,roomId});return f.start();},list:async(id)=>{f.lists.push(auth.user.id);if(f.holdLists)return new Promise(resolve=>f.listPending.push(resolve));return {state:'ready',count:1,waiting:[{userId:auth.user.id,username:auth.user.id}]};}};`],
  ['@dvnt/app/lib/stores/auth-store', `export {useAuthStore} from 'fixture';`],
  ['@dvnt/app/lib/auth/session-lifecycle', `export {getSessionLifecycle,subscribeSessionLifecycle} from 'fixture';`],
  ['@dvnt/app/lib/api/event-lynk', `export {eventLynkApi} from 'fixture';`],
 ]);
 const built=await load('esbuild').build({stdin:{resolveDir:ROOT,loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
  import {useEventLynkEntry} from './packages/app/lib/hooks/use-event-lynk-entry';
  import {useEventLynkHost} from './packages/app/lib/hooks/use-event-lynk-host';import {f,useAuthStore} from 'fixture';
  function App(){const user=useAuthStore(s=>s.user);const h=useEventLynkHost(Number(f.eventId),f.mayHost);
   const entry=useEventLynkEntry({eventId:f.eventId,roomId:f.roomId,viewerId:user?.id,mayHost:f.mayHost,start:h.start,navigate:id=>f.navigations.push(id),onError:m=>f.errors.push(m)});
   f.open=entry.open;f.view=h.view;f.refetch=h.refetch;f.hostStart=h.start;f.isOpening=entry.isOpening;
   return <button disabled={entry.isOpening} onClick={entry.open}>{h.view?.waiting[0]?.username||'no roster'}</button>;}
  const root=createRoot(document.getElementById('root'));const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  f.render=()=>root.render(<QueryClientProvider client={client}><App/></QueryClientProvider>);f.unmount=()=>root.unmount();f.render();`},bundle:true,write:false,alias:reactAliases,platform:'browser',format:'iife',jsx:'automatic',nodePaths:paths,define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{if(boundaries.has(a.path))return{path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/'))return b.resolve(path.join(ROOT,'packages/app',a.path.slice(10)),{resolveDir:ROOT,kind:a.kind});});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:boundaries.get(a.path),loader:'tsx',resolveDir:ROOT}));}}]});
 if (process.argv.includes('--browser')) {
  const browserName=process.env.LYNK_BROWSER || 'chromium';
  const browser=await load('playwright')[browserName].launch({headless:true});
  try {
   const page=await browser.newPage({viewport:{width:390,height:844}});
   const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.setContent('<div id="root"></div>');await page.addScriptTag({content:built.outputFiles[0].text});
   await page.waitForFunction(()=>window.fixture.view);
   await page.evaluate(()=>{window.fixture.open();window.fixture.open();});
   await page.waitForFunction(()=>window.fixture.calls===1);
   assert.equal(await page.evaluate(()=>window.fixture.navigations.length),0);
   await page.evaluate(()=>window.fixture.pending.shift().resolve({state:'live',roomId:'room-42'}));
   await page.waitForFunction(()=>window.fixture.navigations.length===1);
   assert.equal(await page.evaluate(()=>window.fixture.navigations[0]),'room-42');
   await page.evaluate(()=>window.fixture.setAuth('host-b'));
   await page.waitForFunction(()=>window.fixture.view?.waiting[0]?.userId==='host-b');
   await page.evaluate(()=>{window.fixture.open();});
   await page.waitForFunction(()=>window.fixture.calls===2);
   await page.evaluate(()=>{window.fixture.boundary();window.fixture.pending.shift().resolve({state:'live',roomId:'room-42'});});
   await page.waitForFunction(()=>!window.fixture.isOpening);
   assert.equal(await page.evaluate(()=>window.fixture.navigations.length),1);
   assert.deepEqual(errors,[]);
   console.log(`PASS real event Lynk hooks in ${browserName}; synthetic auth/API, not real-session acceptance.`);
  } finally {await browser.close();}
  return;
 }
 const dom=new (load('jsdom').JSDOM)('<div id="root"></div>',{url:'https://fixture.invalid',runScripts:'outside-only',pretendToBeVisual:true});
 const until=async p=>{const end=Date.now()+3000;while(!p()){assert.ok(Date.now()<end,'hook fixture reached state');await new Promise(r=>setTimeout(r,5));}};
 try {dom.window.eval(built.outputFiles[0].text);const f=dom.window.fixture;
  await until(()=>f.view);assert.equal(f.view.waiting[0].userId,'host-a');
  // Hold a poll from the old session, then sign back in as the same account.
  f.holdLists=true;void f.refetch();await until(()=>f.listPending.length===1);
  const oldPoll=f.listPending.shift();const staleStart=f.hostStart;
  f.boundary(false);f.setAuth(null);await until(()=>f.view===null);
  await assert.rejects(staleStart('room-42'),/session changed/);assert.equal(f.calls,0,'stale mutation cannot call API');
  f.setAuth('host-a');f.boundary(true);await until(()=>f.listPending.length===1);
  assert.equal(f.view,null,'same-account reauthentication never reuses cached roster');
  oldPoll({state:'live',count:99,waiting:[{userId:'old-session',username:'old-session'}]});
  await new Promise(r=>setTimeout(r,20));assert.equal(f.view,null,'late old poll cannot populate new session');
  f.listPending.shift()({state:'ready',count:1,waiting:[{userId:'host-a',username:'host-a'}]});await until(()=>f.view);
  // An epoch change with no auth-store change must hide the roster immediately.
  f.boundary();await until(()=>f.listPending.length===1);assert.equal(f.view,null,'epoch-only boundary masks cached data');
  f.listPending.shift()({state:'ready',count:1,waiting:[{userId:'host-a',username:'host-a'}]});await until(()=>f.view);f.holdLists=false;
  f.open();f.open();await until(()=>f.calls===1);assert.equal(f.navigations.length,0);assert.equal(f.view.state,'ready','no optimistic live state');
  f.pending.shift().resolve({state:'live',roomId:'room-42'});await until(()=>f.navigations.length===1);assert.equal(f.navigations[0],'room-42');
  f.open();await until(()=>f.calls===2);f.pending.shift().reject(new dom.window.Error('Event has ended'));await until(()=>f.errors.length===1);assert.equal(f.navigations.length,1);assert.equal(f.errors[0],'Event has ended');
  f.open();await until(()=>f.calls===3);f.eventId='43';f.roomId='room-43';f.render();await until(()=>!f.isOpening);f.pending.shift().resolve({state:'live',roomId:'room-42'});await new Promise(r=>setTimeout(r,20));assert.equal(f.navigations.length,1,'no stale-event navigation');
  f.open();await until(()=>f.calls===4);f.boundary();f.pending.shift().resolve({state:'live',roomId:'room-42'});await until(()=>!f.isOpening);assert.equal(f.navigations.length,1,'no session-boundary navigation');
  f.setAuth('host-b');await until(()=>f.view?.waiting[0]?.userId==='host-b');assert.ok(f.lists.includes('host-b'));
  assert.equal(f.startArgs[0].eventId,42);assert.equal(f.startArgs[0].roomId,'room-42');
  f.open();await until(()=>f.calls===5);f.pending.shift().resolve({state:'live',roomId:'relinked-room'});await until(()=>f.errors.length===2);assert.equal(f.navigations.length,1,'no mismatched-response navigation');
  f.open();await until(()=>f.calls===6);f.pending.shift().reject(new dom.window.Error('This event’s Lynk has changed. Refresh the event and try again.'));await until(()=>f.errors.length===3);assert.equal(f.navigations.length,1,'stale room refusal remains retryable');
  const staleOpen=f.open;f.eventId='44';f.roomId='room-44';f.render();await until(()=>f.view);await new Promise(r=>setTimeout(r,20));staleOpen();await new Promise(r=>setTimeout(r,20));assert.equal(f.calls,6,'old event callback cannot start');
  const callsBeforeAccount=f.calls;f.open();await until(()=>f.calls===callsBeforeAccount+1);f.setAuth('host-c');await until(()=>f.view?.waiting[0]?.userId==='host-c');f.pending.shift().resolve({state:'live',roomId:'room-44'});await new Promise(r=>setTimeout(r,20));assert.equal(f.navigations.length,1,'no previous-account navigation');
  const callsBeforeSignout=f.calls;f.setAuth(null);await until(()=>f.view===null);f.open();await new Promise(r=>setTimeout(r,20));assert.equal(f.calls,callsBeforeSignout,'signed-out entry cannot start');assert.equal(f.navigations.length,1);
  f.setAuth('host-c');await until(()=>f.view);f.eventId='43';f.roomId='room-43';f.render();await new Promise(r=>setTimeout(r,20));
  f.mayHost=false;f.render();await until(()=>f.view===null);f.open();await until(()=>f.navigations.length===2);assert.equal(f.calls,7,'guest does not start room');assert.equal(f.navigations[1],'room-43');
  f.mayHost=true;f.render();await until(()=>f.view);f.open();await until(()=>f.calls===8);f.unmount();f.pending.shift().resolve({state:'live',roomId:'room-42'});await new Promise(r=>setTimeout(r,20));assert.equal(f.navigations.length,2,'no unmounted navigation');
  console.log('PASS real event Lynk hooks: single flight, confirmed start, actionable error/retry, stale event/session/unmount, guest admission route, account-scoped/masked roster. Synthetic jsdom; not device or real-session acceptance.');
 } finally {dom.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
