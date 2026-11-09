const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mocks = {
  'react-native': `import React from 'react'; export const View=({children})=><div>{children}</div>; export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>; export const Pressable=({children,onPress,disabled,accessibilityRole})=><button role={accessibilityRole} disabled={disabled} onClick={onPress}>{children}</button>;`,
  '@dvnt/app/components/ui/switch': `import React from 'react'; export const Switch=({checked,disabled,onCheckedChange})=><button role="switch" aria-checked={checked} disabled={disabled} onClick={()=>onCheckedChange(!checked)}/>;`,
  '@dvnt/app/lib/mmkv-zustand': `export const mmkvStorage={getItem:k=>{if(window.failRead)throw Error('unreadable');return window.saved[k]||null},setItem:(k,v)=>{if(window.failStorage)throw Error('full');window.saved[k]=v}};`,
  '@dvnt/app/lib/stores/auth-store': `import {create} from 'zustand'; export const useAuthStore=create(()=>({user:{authId:'a',username:'alice'},authStatus:'authenticated'})); window.auth=useAuthStore;`,
  '@dvnt/app/lib/stores/location-access-store': `import {create} from 'zustand';export const useLocationAccessStore=create(()=>({owner:'a',blocked:false,hydrationReady:true,settings:{locationEnabled:true,sessionKey:'s1'}}));window.access=useLocationAccessStore;export function locationAllowedFor(owner){const s=useLocationAccessStore.getState();return s.owner===owner&&!s.blocked&&s.hydrationReady&&s.settings?.locationEnabled===true}`,
  '@dvnt/app/lib/hooks/use-member-map': `import {useLocationAccessStore,locationAllowedFor} from '@dvnt/app/lib/stores/location-access-store'; export function useLocationSettings(){const s=useLocationAccessStore();return {settings:s.settings,enabled:locationAllowedFor(s.owner)}};`,
  '@dvnt/app/lib/hooks/use-age-verification': `import {create} from 'zustand';const store=create(()=>({state:'approved',loading:false}));window.verification=store;export function useVerificationState(){const s=store();return {data:{state:s.state},isLoading:s.loading}}`,
  '@tanstack/react-query': `const client={removeQueries:()=>{}};export const useQueryClient=()=>client;export const useQuery=()=>({});`,
  '@dvnt/app/lib/location/sample-exact-distance': `import {useEventsLocationStore} from './packages/app/lib/stores/events-location-store';export async function sampleExactDistance(owner,sessionKey,allowed){window.samples++;if(window.holdSample)await new Promise(r=>window.resolveSample=r);if(!allowed())return;if(window.staleSample)throw Error('stale');window.sampleTime=Date.now();useEventsLocationStore.getState().setDeviceLocation(40,-73,{ownerAuthId:owner,sessionKey,observedAt:window.sampleTime});}`,
  '@dvnt/app/lib/api/member-proximity': `async function call(action,value){window.calls.push({action,value});window.active++;window.maxConcurrent=Math.max(window.maxConcurrent,window.active);try{if(window.hold===action)await new Promise((resolve,reject)=>{window.release=resolve;window.reject=reject});if(window.fail===action)throw Error('offline');if(action==='consentExact')return {consentVersion:2,expiresAt:new Date(Date.now()+60000).toISOString()};return {revoked:true,sharedUntil:new Date(Date.now()+60000).toISOString()};}finally{window.active--}}export const memberProximityApi={publish:value=>call('publish',value),revoke:value=>call('revoke',value),consentExact:(owner,session)=>call('consentExact',{owner,session}),revokeExact:value=>call('revokeExact',value)};`,
  'solito/navigation': `export const useRouter=()=>({back(){}});`,
  'lucide-react': `export const X=()=>null;`,
  '@dvnt/app/features/settings/ui/LocationControls': `export const LocationControls=()=>null;`,
  '@dvnt/app/lib/hooks/use-user-settings': `export const usePrivacySettings=()=>({});export const useUpdatePrivacySettings=()=>({});`,
  './follow-requests-panel': `export const FollowRequestsPanel=()=>null;`,
};
let bundle;
async function buildBrowserFixture() {
  if(!bundle) bundle=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {CityVisibilitySection} from './packages/app/features/settings/privacy.web';import {CityVisibilityCard} from './packages/app/features/settings/ui/CityVisibilityCard';import {useSyncMemberProximityPresence} from './packages/app/lib/hooks/use-member-proximity';import {useEventsLocationStore} from './packages/app/lib/stores/events-location-store';import {useExactDistanceStore} from './packages/app/lib/stores/exact-distance-store';import {useMemberProximitySyncStore} from './packages/app/lib/stores/member-proximity-sync-store';window.events=useEventsLocationStore;window.exact=useExactDistanceStore;window.sync=useMemberProximitySyncStore;window.originalTime=Date.now();useEventsLocationStore.setState({activeCity:{id:1,name:'Test City'},deviceLat:40,deviceLng:-73,deviceObservation:{ownerAuthId:'a',sessionKey:'s1',observedAt:window.originalTime}});function FeedSync(){useSyncMemberProximityPresence();return null}const root=createRoot(document.getElementById('root'));window.render=({show=true,duplicate=window.duplicate,native=window.native}={})=>flushSync(()=>root.render(<React.StrictMode>{show?(native?<CityVisibilityCard/>:<CityVisibilitySection/>):null}{duplicate?<FeedSync/>:null}</React.StrictMode>));window.closeRoot=()=>flushSync(()=>root.unmount());window.render();`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:root,loader:'tsx'}));}}]})).outputFiles[0].text;
  return bundle;
}
module.exports = { buildBrowserFixture };
async function fixture({native=false,duplicate=false,saved={},failRead=false}={}) {
  const {Window}=await import(require.resolve('happy-dom'));
  const bundle = await buildBrowserFixture();
  const w=new Window({url:'https://fixture.invalid',console});
  Object.assign(w,{saved,failRead,native,duplicate,calls:[],samples:0,active:0,maxConcurrent:0});
  w.document.body.innerHTML='<div id="root"></div>';w.eval(bundle);await tick();await tick();return w;
}
const tick=()=>new Promise(r=>setTimeout(r,25));
async function wait(fn){for(let i=0;i<120;i++){if(fn())return;await tick()}assert.ok(fn(),'condition did not settle')}
const buttons=w=>[...w.document.querySelectorAll('button')];
const button=(w,text)=>buttons(w).find(b=>b.textContent===text);
const switches=w=>[...w.document.querySelectorAll('[role=switch]')];
const calls=(w,action)=>w.calls.filter(c=>c.action===action);
async function enable(w){switches(w)[0].click();await tick();switches(w)[1].click();await wait(()=>calls(w,'publish').length>0);await tick()}
async function close(w){w.closeRoot();await w.happyDOM.close()}
if (require.main === module) {
for(const native of [false,true])test(`${native?'native':'web'} direct Settings publishes only explicit distance consent, grants exact with fresh observation, and stops both`,async()=>{
 const w=await fixture({native});try{
  assert.match(w.document.body.textContent,/To allow exact distances/);assert.equal(button(w,'I agree: allow exact distances').disabled,true);
  switches(w)[0].click();await tick();assert.equal(calls(w,'publish').length,0,'city alone never publishes coordinates');
  switches(w)[1].click();await wait(()=>calls(w,'publish').length===1);await tick();
  assert.equal(calls(w,'publish')[0].value.observedAt,new Date(w.originalTime).toISOString());assert.equal(calls(w,'publish')[0].value.exactDistanceVersion,undefined);
  w.holdSample=true;button(w,'I agree: allow exact distances').click();await wait(()=>w.samples===1);assert.ok(button(w,'Getting a fresh location…'));w.resolveSample();await wait(()=>calls(w,'publish').some(c=>c.value.exactDistanceVersion===2));
  assert.equal(calls(w,'consentExact').length,1);assert.equal(calls(w,'publish').at(-1).value.observedAt,new Date(w.sampleTime).toISOString());
  switches(w)[1].click();await wait(()=>!w.sync.getState().pendingWithdrawals.a);await tick();
  assert.equal(w.events.getState().preciseProximityGrant,false);assert.equal(w.exact.getState().owner,null);assert.equal(w.maxConcurrent,1);
  assert.equal(w.saved['events-location'].state.preciseProximityGrant,undefined);assert.deepEqual(Object.keys(w.saved['member-proximity-withdrawals'].state),['pendingWithdrawals']);
 }finally{await close(w)}
});
test('held fresh sample consumes queued intent once and failed exact publication waits for explicit retry',async()=>{
 const w=await fixture();try{
  await enable(w);w.fail='publish';w.holdSample=true;
  button(w,'I agree: allow exact distances').click();await wait(()=>w.samples===1);
  assert.ok(button(w,'Getting a fresh location…'));w.resolveSample();
  await wait(()=>!!button(w,'Retry distance sharing'));await tick();await tick();
  assert.equal(calls(w,'consentExact').length,1);
  assert.equal(calls(w,'publish').length,2,'one coarse publication and one failed exact publication; queued effects must not automatically replay consumed intent');
  const failed=calls(w,'publish').at(-1).value;assert.equal(failed.exactDistanceVersion,2);
  w.fail=null;button(w,'Retry distance sharing').click();await wait(()=>calls(w,'publish').length===3);await tick();
  assert.deepEqual(calls(w,'publish').at(-1).value,failed,'explicit retry preserves the exact observation and consent version');
  assert.equal(w.samples,1);assert.equal(w.maxConcurrent,1);assert.equal(button(w,'Retry distance sharing'),undefined);
 }finally{await close(w)}
});
test('Settings exposes publish failure and retry keeps exact consent version and original sample',async()=>{
 const w=await fixture();try{await enable(w);w.fail='publish';button(w,'I agree: allow exact distances').click();await wait(()=>!!button(w,'Retry distance sharing'));assert.match(w.document.querySelector('[role=alert]').textContent,/Could not update distance sharing/);const failed=calls(w,'publish').at(-1).value;assert.equal(failed.exactDistanceVersion,2);w.fail=null;button(w,'Retry distance sharing').click();await wait(()=>calls(w,'publish').length===3);await tick();assert.equal(calls(w,'publish').at(-1).value.exactDistanceVersion,2);assert.equal(calls(w,'publish').at(-1).value.observedAt,failed.observedAt);assert.equal(w.samples,1);assert.equal(button(w,'Retry distance sharing'),undefined);}finally{await close(w)}
});
for(const native of [false,true])test(`${native?'native':'web'} failed ordinary stop stays off, survives remount, and offers confirmed retry`,async()=>{
 const w=await fixture({native});try{await enable(w);w.fail='revoke';switches(w)[1].click();await wait(()=>!!button(w,'Retry Stop sharing distance')&&!button(w,'Retry Stop sharing distance').disabled);assert.equal(switches(w)[1].getAttribute('aria-checked'),'false');assert.match(w.document.body.textContent,/Could not confirm distance sharing has stopped/);assert.equal(w.saved['member-proximity-withdrawals'].state.pendingWithdrawals.a,true);w.render({show:false});await tick();w.render();await tick();assert.ok(button(w,'Retry Stop sharing distance'));assert.equal(switches(w)[1].disabled,true);w.fail=null;button(w,'Retry Stop sharing distance').click();await wait(()=>!w.sync.getState().pendingWithdrawals.a);await tick();assert.equal(button(w,'Retry Stop sharing distance'),undefined);assert.equal(calls(w,'publish').length,1);}finally{await close(w)}
});
test('duplicate scopes serialize one publish and a stop survives immediate Settings/feed unmount',async()=>{
 const w=await fixture({duplicate:true});try{w.hold='publish';await enable(w);assert.equal(calls(w,'publish').length,1);switches(w)[1].click();w.render({show:false,duplicate:false});await tick();assert.equal(calls(w,'revoke').length,1,'only initial stop, no revoke parallel to held publish');w.hold=null;w.release();await wait(()=>!w.sync.getState().pendingWithdrawals.a);assert.equal(calls(w,'revoke').length,2);assert.equal(calls(w,'publish').length,1);assert.equal(w.maxConcurrent,1);}finally{await close(w)}
});
test('queued exact positive response after all scopes unmount does not publish',async()=>{
 const w=await fixture();try{await enable(w);w.hold='consentExact';button(w,'I agree: allow exact distances').click();await wait(()=>calls(w,'consentExact').length===1);w.render({show:false});await tick();w.hold=null;w.release();await tick();await tick();assert.equal(calls(w,'publish').length,1);}finally{await close(w)}
});
test('failed A stop is not shown or sent as B and stays actionable when A returns',async()=>{
 const w=await fixture();try{await enable(w);w.fail='revoke';switches(w)[1].click();await wait(()=>!!button(w,'Retry Stop sharing distance')&&!button(w,'Retry Stop sharing distance').disabled);w.fail=null;w.auth.setState({user:{authId:'b'}});w.access.setState({owner:'b',settings:{locationEnabled:true,sessionKey:'b1'}});await tick();await tick();assert.doesNotMatch(w.document.body.textContent,/Could not confirm distance sharing has stopped/);assert.equal(calls(w,'revoke').at(-1).value,'b');assert.equal(w.sync.getState().pendingWithdrawals.a,true);w.fail='revoke';w.auth.setState({user:{authId:'a'}});w.access.setState({owner:'a',settings:{locationEnabled:true,sessionKey:'s1'}});await wait(()=>!!button(w,'Retry Stop sharing distance')&&!button(w,'Retry Stop sharing distance').disabled);w.fail=null;button(w,'Retry Stop sharing distance').click();await wait(()=>!w.sync.getState().pendingWithdrawals.a);}finally{await close(w)}
});
test('same-account session replacement never reuses the old observation or exact grant',async()=>{
 const w=await fixture();try{await enable(w);button(w,'I agree: allow exact distances').click();await wait(()=>calls(w,'publish').some(c=>c.value.exactDistanceVersion===2));const count=calls(w,'publish').length;w.access.setState({settings:{locationEnabled:true,sessionKey:'s2'}});await wait(()=>!!button(w,'Retry distance sharing'));assert.match(w.document.body.textContent,/needs a fresh device location/);button(w,'Retry distance sharing').click();await tick();assert.equal(calls(w,'publish').length,count);assert.equal(w.exact.getState().owner,null);}finally{await close(w)}
});
test('a newer city lease is published after an older held request without parallel writes',async()=>{
 const w=await fixture({duplicate:true});try{w.hold='publish';await enable(w);const prior=calls(w,'publish')[0].value.shareUntil;w.events.setState({cityVisibility:{cityId:2,cityName:'Other City',expiresAt:Date.now()+120000}});await tick();w.hold=null;w.release();await wait(()=>calls(w,'publish').length===2);assert.equal(calls(w,'publish')[1].value.cityId,2);assert.notEqual(calls(w,'publish')[1].value.shareUntil,prior);assert.equal(w.maxConcurrent,1);}finally{await close(w)}
});
test('legacy positive coordinate consent never restores and corrupt denial storage fails closed',async()=>{
 const saved={'events-location':{state:{preciseProximityGrant:true,preciseProximityOwnerAuthId:'a',cityVisibility:{cityId:1,cityName:'Test',expiresAt:Date.now()+60000}},version:0},'member-proximity-withdrawals':{state:{pendingWithdrawals:'corrupt'},version:0}};
 const w=await fixture({saved});try{assert.equal(w.events.getState().preciseProximityGrant,false);assert.equal(w.sync.getState().hydrationReady,false);switches(w)[1].click();await tick();assert.equal(calls(w,'publish').length,0);assert.match(w.document.body.textContent,/privacy preferences could not be read/);assert.ok(calls(w,'revoke').length>0);}finally{await close(w)}
});


test('city expiry while Settings remains mounted revokes once and disables both switches',async()=>{
 const w=await fixture({duplicate:true});try{await enable(w);w.events.setState({cityVisibility:{cityId:1,cityName:'Test City',expiresAt:Date.now()+100}});await tick();const before=calls(w,'revoke').length;await wait(()=>calls(w,'revoke').length===before+1);await tick();assert.equal(switches(w)[0].getAttribute('aria-checked'),'false');assert.equal(switches(w)[1].getAttribute('aria-checked'),'false');assert.equal(w.maxConcurrent,1);}finally{await close(w)}
});
test('ordinary Stop still reaches the server when device writes fail and does not persist positive consent',async()=>{
 const w=await fixture();try{await enable(w);w.failStorage=true;switches(w)[1].click();await wait(()=>!w.sync.getState().pendingWithdrawals.a);await tick();assert.equal(calls(w,'revoke').length,2);assert.equal(w.events.getState().preciseProximityGrant,false);assert.match(w.document.body.textContent,/Could not save your stop on this device/);assert.equal(w.saved['events-location'].state.preciseProximityGrant,undefined);}finally{await close(w)}
});
test('signed-out Settings has no leaked status or publication, including after late A failure',async()=>{
 const w=await fixture();try{w.hold='publish';await enable(w);w.auth.setState({user:null,authStatus:'unauthenticated'});w.access.setState({owner:null,settings:null,blocked:true});await tick();w.reject(Error('late A failure'));await tick();assert.doesNotMatch(w.document.body.textContent,/Could not update distance sharing/);assert.equal(calls(w,'publish').length,1);assert.equal(w.document.querySelector('[role=alert]'),null);}finally{await close(w)}
});


for(const native of [false,true])test(`${native?'native':'web'} confirmed ordinary Stop clears only a resolved exact withdrawal error`,async()=>{
 const w=await fixture({native});try{
  await enable(w);button(w,'I agree: allow exact distances').click();await wait(()=>calls(w,'publish').some(c=>c.value.exactDistanceVersion===2));await tick();
  w.fail='revokeExact';button(w,'Stop exact distances').click();await wait(()=>w.exact.getState().pendingWithdrawals.a&&button(w,'Retry Stop exact distances')&&!button(w,'Retry Stop exact distances').disabled);
  assert.match(w.document.body.textContent,/Could not confirm withdrawal/);const count=calls(w,'publish').length;
  w.hold='revoke';switches(w)[1].click();await wait(()=>!!w.release);assert.match(w.document.body.textContent,/Could not confirm withdrawal/,'pending withdrawal keeps its error until the server confirms');
  w.hold=null;w.release();await wait(()=>!w.sync.getState().pendingWithdrawals.a&&!w.exact.getState().pendingWithdrawals.a);await tick();
  assert.doesNotMatch(w.document.body.textContent,/Could not confirm withdrawal/);assert.equal(button(w,'Retry Stop exact distances'),undefined);assert.equal(button(w,'I agree: allow exact distances').disabled,true);
  assert.equal(calls(w,'publish').length,count);assert.equal(w.events.getState().preciseProximityGrant,false);assert.equal(w.exact.getState().owner,null);assert.equal(w.maxConcurrent,1);
  w.exact.getState().beginWithdrawal('a');await tick();assert.doesNotMatch(w.document.body.textContent,/Could not confirm withdrawal/,'a later withdrawal cannot resurrect the resolved operation error');
 }finally{await close(w)}
});

}
