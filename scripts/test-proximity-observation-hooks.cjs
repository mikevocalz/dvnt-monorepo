const assert=require('node:assert/strict'),path=require('node:path');
const {build}=require('esbuild');
(async()=>{
 const {Window}=await import(require.resolve('happy-dom'));const root=path.resolve(__dirname,'..');
 const mocks={
  '@dvnt/app/lib/mmkv-zustand':`export const mmkvStorage={getItem:name=>name==='events-location'?window.fixture.persisted:null,setItem:(name,value)=>{if(name==='events-location')window.fixture.saved=value;},removeItem(){}};`,
  '@dvnt/app/lib/stores/auth-store':`import {create} from 'zustand';export const useAuthStore=create(()=>({user:{authId:'a'}}));window.auth=useAuthStore;`,
  '@dvnt/app/lib/stores/location-access-store':`import {create} from 'zustand';export const useLocationAccessStore=create(()=>({owner:'a',blocked:false,hydrationReady:true,settings:{locationEnabled:true,sessionKey:'s1'}}));export const locationAllowedFor=owner=>useLocationAccessStore.getState().owner===owner&&!useLocationAccessStore.getState().blocked;window.access=useLocationAccessStore;`,
  '@dvnt/app/lib/stores/exact-distance-store':`import {create} from 'zustand';export const useExactDistanceStore=create(()=>({owner:'a',sessionKey:'s1',expiresAt:Date.now()+3600000,generation:0,pendingWithdrawals:{}}));window.exact=useExactDistanceStore;`,
  '@dvnt/app/lib/hooks/use-member-map':`import {useLocationAccessStore} from '@dvnt/app/lib/stores/location-access-store';export function useLocationSettings(){const s=useLocationAccessStore();return {enabled:!s.blocked,settings:s.settings}}`,
  '@dvnt/app/lib/hooks/use-age-verification':`export const useVerificationState=()=>({data:{state:'approved'},isLoading:false});`,
  '@dvnt/app/lib/api/member-proximity':`export const memberProximityApi={publish:async input=>window.fixture.publishes.push(input),revoke:async()=>window.fixture.revokes++};`,
  'expo-location':`export const Accuracy={Balanced:3};export const getForegroundPermissionsAsync=async()=>({status:'granted'});export const getCurrentPositionAsync=async()=>({coords:{latitude:41,longitude:-73},timestamp:window.fixture.providerTimestamp});`,
 };
 const output=await build({nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {useSyncMemberProximityPresence} from './packages/app/lib/hooks/use-member-proximity';import {useEventsLocationStore} from './packages/app/lib/stores/events-location-store';import {sampleExactDistance} from './packages/app/lib/location/sample-exact-distance';window.events=useEventsLocationStore;window.sample=sampleExactDistance;function App(){useSyncMemberProximityPresence();return null}const root=createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();root.render(<App/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>{if(mocks[a.path])return {path:a.path,namespace:'mock'};if(a.path.startsWith('@dvnt/app/'))return {path:path.join(root,'packages/app',a.path.slice('@dvnt/app/'.length))+'.ts'}});b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js',resolveDir:root}));}}]});
 const win=new Window({url:'https://fixture.test',console,settings:{enableJavaScriptEvaluation:true}});
 const now=Date.now();win.fixture={publishes:[],revokes:0,persisted:{state:{deviceLat:40,deviceLng:-74,deviceObservation:{observedAt:now,ownerAuthId:'a',sessionKey:'s1'},cityVisibility:{cityId:1,cityName:'City',expiresAt:now+3600000},preciseProximityGrant:true,preciseProximityOwnerAuthId:'a'},version:0}};
 win.document.body.innerHTML='<div id="root"></div>';
 const tick=()=>new Promise(r=>setTimeout(r,40));const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await tick();}assert.ok(fn());};
 try{
  win.eval(output.outputFiles[0].text);await tick();
  assert.equal(win.events.getState().deviceObservation,null,'hydration never restores freshness');
  assert.equal(win.fixture.publishes.length,0,'unknown persisted coordinates never publish');
  win.events.getState().setDeviceLocation(40,-74,{observedAt:now-960000,ownerAuthId:'a',sessionKey:'s1'});await tick();
  assert.equal(win.fixture.publishes.length,0,'ancient coordinates cannot obtain a new lease');
  const fresh=Date.now()-5000;
  win.events.getState().setDeviceLocation(40,-74,{observedAt:fresh,ownerAuthId:'a',sessionKey:'s1'});
  await wait(()=>win.fixture.publishes.length===1);
  assert.equal(win.fixture.publishes[0].observedAt,new Date(fresh).toISOString(),'original provider observation, not publication time');
  assert.equal(win.fixture.publishes[0].exactDistanceVersion,2);
  win.exact.setState({generation:1});win.events.setState({cityVisibility:{...win.events.getState().cityVisibility,expiresAt:Date.now()+3600000}});await tick();
  assert.equal(win.fixture.publishes.length,1,'consent/city renewal cannot replay or freshen a sample');
  win.access.setState({settings:{locationEnabled:true,sessionKey:'s2'}});win.exact.setState({sessionKey:'s2',generation:2});await tick();
  assert.equal(win.fixture.publishes.length,1,'same-account new sign-in cannot reuse old-session observation');
  win.fixture.providerTimestamp=Date.now();
  await win.sample('a','s2',()=>true);await wait(()=>win.fixture.publishes.length===2);
  assert.equal(win.fixture.publishes[1].observedAt,new Date(win.fixture.providerTimestamp).toISOString());
  assert.equal(win.fixture.saved.state.deviceObservation,undefined,'observation is never persisted');
  for(const invalid of [Date.now()-960000,Date.now()+60000,undefined]){
   win.fixture.providerTimestamp=invalid;
   await assert.rejects(()=>win.sample('a','s2',()=>true),/fresh location/);
  }
  assert.equal(win.fixture.publishes.length,2,'cached/future/unknown provider samples never publish');
  console.log('PASS: actual publisher/store/sample reject restored, ancient, replayed and other-session observations; fresh original timestamps publish without lease renewal');
 }finally{win.unmount?.();await win.happyDOM.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
