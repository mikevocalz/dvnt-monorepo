const assert=require('node:assert/strict'),path=require('node:path');
const {build}=require('esbuild');
(async()=>{
 const {Window}=await import(require.resolve('happy-dom'));
 const root=path.resolve(__dirname,'..');
 const mocks={
  '@dvnt/app/lib/stores/exact-distance-store':`export const useExactDistanceStore={getState:()=>({owner:null,clear(){},confirmWithdrawal(){},beginWithdrawal(){}})};`,
  'react-native':`export const Platform={OS:'android'};export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};`,
  'expo-location':`export const Accuracy={Balanced:3};export const getForegroundPermissionsAsync=async()=>({status:'granted'});export const requestForegroundPermissionsAsync=getForegroundPermissionsAsync;export const getCurrentPositionAsync=async()=>({coords:{latitude:40.12,longitude:-74.12},timestamp:Date.now()});`,
  '@dvnt/app/lib/mmkv-zustand':`export const mmkvStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`,
  '@dvnt/app/lib/stores/auth-store':`import {useSyncExternalStore} from 'react';export const useAuthStore=s=>useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>s({user:window.fixture.user}));useAuthStore.getState=()=>({user:window.fixture.user});`,
  '@dvnt/app/lib/stores/events-location-store':`const state={activeCity:null};export const useEventsLocationStore={getState:()=>state,setState:x=>Object.assign(state,typeof x==='function'?x(state):x)};`,
  '@dvnt/app/lib/api/member-map':`export const memberMapApi={settings:async()=>({...window.fixture.settings}),updateSettings:async(o,input)=>{const f=window.fixture;if(input.expectedRevision!==f.settings.revision)throw Error('revision changed');const next={...f.settings,locationEnabled:input.locationEnabled,eventsMapEnabled:input.eventsMapEnabled,consentVersion:input.consentVersion,revision:f.settings.revision+1,shareUntil:input.eventsMapEnabled?f.settings.sessionExpiresAt:null};f.settings=next;f.calls.push({action:'update',input});if(input.eventsMapEnabled&&f.defer)await new Promise(r=>f.release=r);return next},publish:async()=>{window.fixture.calls.push({action:'publish'});return {}},revoke:async()=>({...window.fixture.settings,eventsMapEnabled:false,shareUntil:null}),nearby:async()=>({members:[]})};`,
 };
 const out=await build({nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {useLocationSettings,useMapSharingConsent} from './packages/app/lib/hooks/use-member-map.ts';import {useLocationAccessStore} from './packages/app/lib/stores/location-access-store.ts';import {publishSessionBoundary} from './packages/app/lib/auth/session-lifecycle.ts';const q=new QueryClient({defaultOptions:{queries:{retry:false}}});window.fixture.q=q;window.fixture.access=useLocationAccessStore;window.fixture.boundary=publishSessionBoundary;function App(){window.fixture.location=useLocationSettings();window.fixture.consent=useMapSharingConsent(true);return null}const root=createRoot(document.getElementById('root'));window.fixture.unmount=()=>root.unmount();root.render(<QueryClientProvider client={q}><App/></QueryClientProvider>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>{if(mocks[a.path])return {path:a.path,namespace:'mock'};if(a.path.startsWith('@dvnt/app/'))return {path:path.join(root,'packages/app',a.path.slice('@dvnt/app/'.length))+'.ts'}});b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js',resolveDir:root}));}}]});
 const win=new Window({url:'https://fixture.test',console,settings:{enableJavaScriptEvaluation:true}});
 win.document.body.innerHTML='<div id="root"></div>';
 win.fixture={user:{authId:'viewer'},settings:{locationEnabled:false,eventsMapEnabled:false,shareUntil:null,revision:0,sessionKey:'signin-a',sessionExpiresAt:'2099-01-01T00:00:00Z'},calls:[],defer:true};
 const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.ok(fn());};
 try{
  win.eval(out.outputFiles[0].text);
  await wait(()=>win.fixture.access.getState().settings!==null);
  const pending=win.fixture.consent.share();
  await wait(()=>!!win.fixture.release);
  assert.equal(win.fixture.calls[0].input.consentVersion,'events-map-session-v2');
  assert.equal(win.fixture.calls[0].input.expectedSessionId,'signin-a');
  win.fixture.boundary({ready:false});
  assert.equal(win.fixture.access.getState().blocked,true,'session boundary stops local writers synchronously');
  win.fixture.settings={...win.fixture.settings,sessionKey:'signin-b',eventsMapEnabled:false,shareUntil:null,revision:2};
  win.fixture.boundary({ready:true,authId:'viewer'});
  win.fixture.release();
  assert.equal(await pending,false);
  assert.equal(win.fixture.calls.some(c=>c.action==='publish'),false,'late consent from previous same-account sign-in never publishes');
  console.log('PASS: actual map hook sends session-bound consent and rejects a late previous-sign-in response');
 }finally{win.fixture.unmount?.();win.fixture.q?.clear();await win.happyDOM.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
