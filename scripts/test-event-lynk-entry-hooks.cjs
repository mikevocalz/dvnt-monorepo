#!/usr/bin/env node
// Execute the real React hooks with synthetic API/auth boundaries. No live writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const paths = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), ROOT];
const load = n => require(require.resolve(n, {paths}));
(async () => {
 const boundaries = new Map([
  ['fixture', `import {useSyncExternalStore} from 'react';
   let auth={user:{id:'host-a'},isAuthenticated:true};const listeners=new Set();
   export const f=window.fixture={calls:0,navigations:[],errors:[],epoch:1,pending:[],lists:[],eventId:'42',roomId:'room-42',mayHost:true,
    setAuth(id){auth={user:id?{id}:null,isAuthenticated:!!id};for(const l of listeners)l();},
    start(){f.calls++;return new Promise((resolve,reject)=>f.pending.push({resolve,reject}));}};
   export const useAuthStore=select=>select(useSyncExternalStore(l=>{listeners.add(l);return()=>listeners.delete(l)},()=>auth));
   export const getSessionLifecycle=()=>({epoch:f.epoch,ready:true});
   export const eventLynkApi={start:()=>f.start(),list:async(id)=>{f.lists.push(auth.user.id);return {state:'ready',count:1,waiting:[{userId:auth.user.id,username:auth.user.id}]};}};`],
  ['@dvnt/app/lib/stores/auth-store', `export {useAuthStore} from 'fixture';`],
  ['@dvnt/app/lib/auth/session-lifecycle', `export {getSessionLifecycle} from 'fixture';`],
  ['@dvnt/app/lib/api/event-lynk', `export {eventLynkApi} from 'fixture';`],
 ]);
 const built=await load('esbuild').build({stdin:{resolveDir:ROOT,loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
  import {useEventLynkEntry} from './packages/app/lib/hooks/use-event-lynk-entry';
  import {useEventLynkHost} from './packages/app/lib/hooks/use-event-lynk-host';import {f,useAuthStore} from 'fixture';
  function App(){const user=useAuthStore(s=>s.user);const h=useEventLynkHost(Number(f.eventId),f.mayHost);
   const entry=useEventLynkEntry({eventId:f.eventId,roomId:f.roomId,viewerId:user?.id,mayHost:f.mayHost,start:h.start,navigate:id=>f.navigations.push(id),onError:m=>f.errors.push(m)});
   f.open=entry.open;f.view=h.view;f.isOpening=entry.isOpening;
   return <button disabled={entry.isOpening} onClick={entry.open}>{h.view?.waiting[0]?.username||'no roster'}</button>;}
  const root=createRoot(document.getElementById('root'));const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  f.render=()=>root.render(<QueryClientProvider client={client}><App/></QueryClientProvider>);f.unmount=()=>root.unmount();f.render();`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',nodePaths:paths,define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{if(boundaries.has(a.path))return{path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/'))return b.resolve(path.join(ROOT,'packages/app',a.path.slice(10)),{resolveDir:ROOT,kind:a.kind});});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:boundaries.get(a.path),loader:'tsx',resolveDir:ROOT}));}}]});
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
   await page.evaluate(()=>window.fixture.pending.shift().resolve({state:'live'}));
   await page.waitForFunction(()=>window.fixture.navigations.length===1);
   assert.equal(await page.evaluate(()=>window.fixture.navigations[0]),'room-42');
   await page.evaluate(()=>window.fixture.setAuth('host-b'));
   await page.waitForFunction(()=>window.fixture.view?.waiting[0]?.userId==='host-b');
   await page.evaluate(()=>{window.fixture.open();});
   await page.waitForFunction(()=>window.fixture.calls===2);
   await page.evaluate(()=>{window.fixture.epoch++;window.fixture.pending.shift().resolve({state:'live'});});
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
  f.open();f.open();await until(()=>f.calls===1);assert.equal(f.navigations.length,0);assert.equal(f.view.state,'ready','no optimistic live state');
  f.pending.shift().resolve({state:'live'});await until(()=>f.navigations.length===1);assert.equal(f.navigations[0],'room-42');
  f.open();await until(()=>f.calls===2);f.pending.shift().reject(new dom.window.Error('Event has ended'));await until(()=>f.errors.length===1);assert.equal(f.navigations.length,1);assert.equal(f.errors[0],'Event has ended');
  f.open();await until(()=>f.calls===3);f.eventId='43';f.roomId='room-43';f.render();await until(()=>!f.isOpening);f.pending.shift().resolve({state:'live'});await new Promise(r=>setTimeout(r,20));assert.equal(f.navigations.length,1,'no stale-event navigation');
  f.open();await until(()=>f.calls===4);f.epoch++;f.pending.shift().resolve({state:'live'});await until(()=>!f.isOpening);assert.equal(f.navigations.length,1,'no session-boundary navigation');
  f.setAuth('host-b');await until(()=>f.view?.waiting[0]?.userId==='host-b');assert.ok(f.lists.includes('host-b'));
  f.mayHost=false;f.render();await until(()=>f.view===null);f.open();await until(()=>f.navigations.length===2);assert.equal(f.calls,4,'guest does not start room');assert.equal(f.navigations[1],'room-43');
  f.mayHost=true;f.render();await until(()=>f.view);f.open();await until(()=>f.calls===5);f.unmount();f.pending.shift().resolve({state:'live'});await new Promise(r=>setTimeout(r,20));assert.equal(f.navigations.length,2,'no unmounted navigation');
  console.log('PASS real event Lynk hooks: single flight, confirmed start, actionable error/retry, stale event/session/unmount, guest admission route, account-scoped/masked roster. Synthetic jsdom; not device or real-session acceptance.');
 } finally {dom.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
