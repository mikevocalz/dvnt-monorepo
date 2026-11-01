#!/usr/bin/env node
// Mount the production manual-door roster. Only query/native geometry boundaries
// are fixtures; row eligibility, filtering, counts, store and cache are real.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),nodePaths=(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean).map(p=>path.resolve(p));
const resolve=n=>require.resolve(n,{paths:[ROOT,...nodePaths]});
const mocks={
 'fixture':`export const state={rows:[],checks:[],options:[],loads:[],error:false,status:null,account:'staff',event:'fixture-event'};`,
 '@dvnt/app/lib/stores/auth-store':`import {state} from 'fixture';export const useAuthStore=Object.assign(s=>s({user:{id:state.account,authId:'auth'}}),{getState:()=>({user:{id:state.account,authId:'auth'}})});`,
 '@dvnt/app/lib/api/tickets':`import {state} from 'fixture';export const ticketsApi={getEventTickets:async(eventId,isCurrent)=>{state.loads.push(eventId);if(!isCurrent())throw Error('scope changed');return state.rows;}};`,
 '@tanstack/react-query':`import {state} from 'fixture';export const useQuery=options=>{state.options.push(options);return {data:{tickets:state.rows},isLoading:false,isError:state.error,error:state.status?{status:state.status}:null,refetch:()=>{}}};`,
 '@tanstack/react-virtual':`export const useVirtualizer=({count})=>({getTotalSize:()=>count*68,getVirtualItems:()=>Array.from({length:count},(_,index)=>({index,start:index*68})),measureElement:()=>{}});`,
 'lucide-react':`export const Search=()=>null;export const Check=()=>null;export const X=()=>null;`,
};
(async()=>{
 const {Window}=await import(resolve('happy-dom'));const window=new Window({url:'https://door-fixture.invalid'});Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'door-roster-service-'));let renderer,f;
 try{
  await require(resolve('esbuild')).build({stdin:{resolveDir:ROOT,loader:'tsx',contents:`import React from 'react';export {React};export {act} from 'react';export {createRoot} from 'react-dom/client';import {DoorGuestList,useDoorRosterCounts} from './packages/app/features/events/door-guest-list.web';export {useGuestListStore as store} from './packages/app/features/events/door-guest-list.web';export {recallRoster} from './packages/app/features/events/door-roster-cache.web';import {state} from 'fixture';export {state};export const App=()=>{const counts=useDoorRosterCounts(state.event);return <><output>{JSON.stringify(counts)}</output><DoorGuestList eventId={state.event} checkingInToken={null} onCheckIn={token=>state.checks.push(token)}/></>};`},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:path.join(dir,'app.cjs'),nodePaths,alias:Object.fromEntries(['react','react-dom','zustand'].map(n=>[n,path.dirname(resolve(n+'/package.json'))])),tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},plugins:[{name:'offline-roster',setup(b){b.onResolve({filter:/.*/},a=>{if(Object.hasOwn(mocks,a.path))return{path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/')){const p=path.join(ROOT,'packages/app',a.path.slice(10));for(const x of ['.ts','.tsx'])if(fs.existsSync(p+x))return{path:p+x};}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:ROOT}));}}]});
  f=require(path.join(dir,'app.cjs'));const flush=async run=>f.act(async()=>{if(run)await run();await new Promise(r=>setTimeout(r,10));});
  f.state.rows=[
   {id:'admission-open',category:'admission',status:'active',holder_name:'Admission holder',qr_token:'admission-token'},
   {id:'admission-used',category:'admission',status:'scanned',holder_name:'Inside holder',qr_token:'used-admission',checked_in_at:'2026-01-01T00:00:00Z'},
   {id:'service-open',category:'service',status:'active',holder_name:'Service holder',qr_token:'service-token'},
   {id:'service-used',category:'service',status:'scanned',holder_name:'Redeemed service holder',qr_token:'used-service',checked_in_at:'2026-01-01T00:00:00Z'},
   {id:'product-open',category:'product',status:'active',holder_name:'Product holder',qr_token:'product-token'},
   {id:'service-refund',category:'service',status:'refunded',holder_name:'Refunded holder',qr_token:'refund-service'},
  ];
  window.localStorage.setItem('dvnt.door.roster.v1',JSON.stringify({'fixture-event':{at:Date.now(),guests:[{id:'old-service',status:'active',qr_token:'old-token'}]}}));
  assert.equal(f.recallRoster('fixture-event','staff:auth'),null,'pre-purpose snapshots cannot authorize manual admission');
  const host=document.createElement('div');document.body.append(host);renderer=f.createRoot(host);
  const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  const checkButtons=()=>[...host.querySelectorAll('button')].filter(b=>b.textContent==='Check in');
  await flush(()=>renderer.render(f.React.createElement(f.App)));
  assert.deepEqual(JSON.parse(host.querySelector('output').textContent),{total:2,checkedIn:1});
  const initialQuery=f.state.options.at(-1);
  assert.ok(initialQuery.queryKey.includes('staff:auth'));
  await initialQuery.queryFn({signal:{aborted:false}});assert.deepEqual(f.state.loads,['fixture-event']);
  await assert.rejects(()=>initialQuery.queryFn({signal:{aborted:true}}),/scope changed/);
  f.state.account='other';await assert.rejects(()=>initialQuery.queryFn({signal:{aborted:false}}),/scope changed/);f.state.account='staff';
  assert.ok(button('All 5'));assert.ok(button('Checked in 1'));assert.ok(button('Not in yet 1'));assert.ok(button('Refunded 1'));
  assert.match(host.textContent,/Service holder/);assert.match(host.textContent,/Product holder/);assert.match(host.textContent,/Redeemed · no entry/);
  assert.equal(checkButtons().length,1);await flush(()=>checkButtons()[0].click());assert.deepEqual(f.state.checks,['admission-token']);
  assert.deepEqual(f.recallRoster('fixture-event','staff:auth').guests.map(x=>x.category),['admission','admission','service','service','product','service']);
  await flush(()=>button('Checked in 1').click());assert.doesNotMatch(host.textContent,/Service holder|Redeemed service holder/);assert.equal(checkButtons().length,0);
  await flush(()=>button('Not in yet 1').click());assert.equal(checkButtons().length,1);assert.doesNotMatch(host.textContent,/Service holder|Product holder/);
  await flush(()=>button('Refunded 1').click());assert.match(host.textContent,/Refunded holder/);assert.match(host.textContent,/Not valid/);assert.equal(checkButtons().length,0);
  assert.equal(f.recallRoster('fixture-event','another:auth'),null,'another account cannot read the saved roster');
  assert.equal(f.recallRoster('another-event','staff:auth'),null,'another event cannot read the saved roster');
  f.state.rows=Array.from({length:401},(_,i)=>({id:`row-${i}`,category:'admission',status:'active',holder_name:`Holder ${i}`,guest_email:`holder${i}@example.invalid`,qr_token:`synthetic-${i}`}));
  await flush(()=>{f.store.getState().setFilter('all');renderer.render(f.React.createElement(f.App));});
  assert.deepEqual(JSON.parse(host.querySelector('output').textContent),{total:401,checkedIn:0});
  await flush(()=>f.store.getState().setQuery('holder400@example.invalid'));
  assert.match(host.textContent,/Holder 400/);assert.equal(checkButtons().length,1);
  await flush(()=>checkButtons()[0].click());assert.equal(f.state.checks.at(-1),'synthetic-400','same scan callback handles rows beyond200');
  Object.defineProperty(global,'navigator',{configurable:true,value:{onLine:false}});
  f.state.error=true;f.state.rows=[];
  await flush(()=>{f.store.getState().setQuery('Holder 400');renderer.render(f.React.createElement(f.App));});
  assert.match(host.textContent,/Offline/);assert.match(host.textContent,/Holder 400/);
  f.state.status=403;await flush(()=>renderer.render(f.React.createElement(f.App)));assert.doesNotMatch(host.textContent,/Holder 400|Offline/,'revoked access never uses offline snapshot');f.state.status=null;
  f.state.account='another';await flush(()=>renderer.render(f.React.createElement(f.App)));
  assert.doesNotMatch(host.textContent,/Holder 400|Offline/);assert.equal(checkButtons().length,0);
  f.state.account='staff';f.state.event='another-event';await flush(()=>renderer.render(f.React.createElement(f.App)));
  assert.doesNotMatch(host.textContent,/Holder 400|Offline/);
  f.state.event='fixture-event';navigator.onLine=true;await flush(()=>renderer.render(f.React.createElement(f.App)));
  assert.doesNotMatch(host.textContent,/Holder 400|Offline/,'online permission/network errors do not expose saved roster');
  console.log('PASS: service/product rows stay visible, never offer manual admission or inflate admission progress; category survives cache');
 }finally{if(renderer&&f)await f.act(()=>renderer.unmount());await window.happyDOM.abort();fs.rmSync(dir,{recursive:true,force:true});}
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
