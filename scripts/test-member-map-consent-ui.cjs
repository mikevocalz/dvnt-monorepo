const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const mocks = {
  'solito/navigation': `export const useRouter=()=>({push:p=>{window.fixture.route=p}});`,
  '@dvnt/app/lib/stores/events-screen-store': `export const useEventsScreenStore={getState:()=>({setSelectedMapEventId:id=>{window.fixture.selection=id},setShowMapView:v=>{window.fixture.openedMap=v}})};`,
  '@dvnt/app/lib/mmkv-zustand': `export const mmkvStorage=window.fixture.noStorage?undefined:{getItem:k=>{if(window.fixture.failRead)throw Error('Unreadable');return window.fixture.storage[k]||null},setItem:async(k,v)=>{if(window.fixture.failWrite)throw Error('Disk full');if(window.fixture.deferWrite)await new Promise(r=>window.fixture.finishWrite=r);window.fixture.storage[k]=v}};`,
  '@dvnt/app/lib/stores/auth-store': `import {useSyncExternalStore} from 'react';export const useAuthStore=s=>useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>s({user:window.fixture.owner?{authId:window.fixture.owner}:null}));useAuthStore.getState=()=>({user:window.fixture.owner?{authId:window.fixture.owner}:null});`,
  '@dvnt/app/lib/hooks/use-member-map': `import {useSyncExternalStore} from 'react';function tick(){useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>window.fixture.version)}export function useLocationSettings(){tick();return {...window.fixture.location,setSharing:async n=>{window.fixture.stops.push(n)},setOverall:async n=>{window.fixture.overall.push(n)},refresh:async()=>{}}}export function useMapSharingConsent(){tick();return {busy:false,error:window.fixture.error,share:async()=>{window.fixture.shares++;return window.fixture.result},cancel:()=>{window.fixture.cancels++}}}`,
  'react-native': `import React from 'react';export const Platform={OS:'web'};export const View=({children,...p})=><div>{children}</div>;export const ScrollView=View;export const Text=({children,accessibilityRole})=><p role={accessibilityRole==='header'?'heading':accessibilityRole}>{children}</p>;export const Pressable=({children,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{children}</button>;export const Modal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;`,
};
async function bundle(native) {
  return build({stdin:{contents:`import React,{useSyncExternalStore} from 'react';import {createRoot} from 'react-dom/client';import {MapSharingConsent} from './packages/app/features/events/map-sharing-consent${native?'':'.web'}.tsx';function App(){useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>window.fixture.version);return window.fixture.mounted?<>{window.fixture.entry!==false?<MapSharingConsent active={window.fixture.active} promptOnly/>:null}{window.fixture.map!==false?<MapSharingConsent active={window.fixture.active}/>:null}</>:null}createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',nodePaths:[process.env.NODE_PATH||path.join(root,'node_modules')],plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>{if(mocks[a.path])return {path:a.path,namespace:'mock'};});b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}));}}]});
}
(async()=>{
 const outputs=await Promise.all([bundle(false),bundle(true)]);
 if(process.argv.includes('--build-only')){console.log('PASS: web and native consent UI fixtures compile');return;}
 const browser=await (process.env.MAP_BROWSER==='webkit'?webkit:chromium).launch({headless:true});
 try {
 for(const native of [false,true]) {
 const page=await browser.newPage({viewport:{width:393,height:852}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function reset(extra={}){await page.route('https://fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://fixture.test/');await page.setContent('<div id="root"></div>');await page.evaluate(extra=>{window.fixture={owner:'synthetic-a',active:true,mounted:true,version:0,storage:{},shares:0,cancels:0,stops:[],overall:[],result:false,error:null,location:{loading:false,busy:false,error:null,needsLocationStop:false,sharing:false,settings:{sessionKey:'session-a',sessionExpiresAt:'2099-01-01T00:00:00Z',locationEnabled:false,eventsMapEnabled:false,revision:0,shareUntil:null}},...extra};},extra);await page.evaluate(()=>{if(window.fixture.blockLocalStorage)Object.defineProperty(window,'localStorage',{get(){throw Error('Access denied')}})});await page.addScriptTag({content:outputs[Number(native)].outputFiles[0].text});}
 await reset();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('dialog').count(),1,'entry and map mount only one visible dialog');assert.equal(await page.evaluate(()=>window.fixture.shares),0,'opening disclosure never requests location');
 assert.match(await page.getByRole('dialog').innerText(),/about 1 km/);assert.match(await page.getByRole('dialog').innerText(),/eligible nearby DVNT members/);assert.match(await page.getByRole('dialog').innerText(),/15 minutes/);
 if(!native)assert.equal(await page.getByRole('button',{name:'Not now',exact:true}).evaluate(e=>document.activeElement===e),true,'focus starts on safe dismissal');
 await page.getByRole('button',{name:'Not now',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.fixture.shares),0);
 await page.evaluate(()=>{window.fixture.mounted=false;window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.waitForTimeout(20);
 await page.evaluate(()=>{window.fixture.mounted=true;window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'remount honors account cooldown');
 const savedStorage=await page.evaluate(()=>window.fixture.storage);await reset({storage:savedStorage});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'fresh page load honors durable cooldown');
 // A new sign-in on the same device is not a new invitation after dismissal.
 await page.evaluate(()=>{window.fixture.location.settings.sessionKey='session-b';window.fixture.version++;dispatchEvent(new Event('fixturechange'));});
 await page.waitForTimeout(50);assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'new sign-in preserves negative UI preference');
 await reset({storage:savedStorage,location:{loading:false,busy:false,error:null,needsLocationStop:false,sharing:false,settings:{sessionKey:'session-c',sessionExpiresAt:'2099-01-01T00:00:00Z',locationEnabled:false,eventsMapEnabled:false,revision:0,shareUntil:null}}});
 await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();
 await page.waitForTimeout(50);assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'reload with a new sign-in preserves dismissal');
 await page.getByRole('button',{name:'Show my avatar',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Share my location',exact:true}).click();assert.equal(await page.evaluate(()=>window.fixture.shares),1,'explicit share is only permission entry');
 if(!native){await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});}else await page.getByRole('button',{name:'Not now',exact:true}).click();
 await page.evaluate(()=>{window.fixture.owner='synthetic-b';window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>window.fixture.shares),1,'account switch never reuses positive consent');
 await page.evaluate(()=>{window.fixture.owner=null;window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.getByRole('dialog').waitFor({state:'detached'});
 await reset({location:{loading:false,busy:false,error:null,needsLocationStop:false,sharing:false,settings:{sessionKey:'session-a',sessionExpiresAt:'2099-01-01T00:00:00Z',locationEnabled:true,eventsMapEnabled:true,revision:3,shareUntil:'2000-01-01T00:00:00Z'}}});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('dialog').isVisible(),true,'expired grant can invite explicit renewal without sharing automatically');assert.equal(await page.evaluate(()=>window.fixture.shares),0);
 await reset({active:false});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Show my avatar',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false);
 await reset({map:false,location:{loading:false,busy:false,error:'Withdrawal not confirmed',needsLocationStop:true,sharing:false,settings:{sessionKey:'session-a',sessionExpiresAt:'2099-01-01T00:00:00Z',locationEnabled:true,eventsMapEnabled:true,revision:4,shareUntil:null}}});await page.getByRole('button',{name:'Turn all location off',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.fixture.overall),[false]);
 // Events list alone prompts before opening the map, without a permanent controls box.
 await reset({map:false});await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('button',{name:'Show my avatar',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.fixture.shares),0);
 await page.evaluate(()=>{window.fixture.active=false;window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.evaluate(()=>{window.fixture.active=true;window.fixture.map=true;window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'returning to tab or opening map does not duplicate entry prompt');
 // Map-only route retains manual opt-in, with no automatic invitation.
 await reset({entry:false});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false);
 await page.getByRole('button',{name:'Show my avatar',exact:true}).click();await page.getByRole('dialog').waitFor();
 // Signing in after visiting Events prompts for the newly signed-in owner.
 await reset({owner:null,map:false});assert.equal(await page.getByRole('dialog').count(),0);
 await page.evaluate(()=>{window.fixture.owner='signed-in-later';window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.getByRole('dialog').waitFor();
 if(!native){
 await reset({map:false,result:true});await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'Share my location',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.openedMap===true);
 assert.equal(await page.evaluate(()=>window.fixture.route),'/events','successful explicit sharing opens Events on phone-sized web');
 assert.equal(await page.evaluate(()=>window.fixture.selection),null,'clear stale event selection to show nearby members');
 await reset({map:false,result:false});await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'Share my location',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.fixture.openedMap),undefined,'failed or denied permission does not open map');
 }
 // Upgrade existing negative-only session memory without granting anything.
 await reset({storage:{'member-map-session-prompt:synthetic-a:session-a':{state:{dismissed:true},version:2}}});
 await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();await page.waitForTimeout(50);
 assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'legacy dismissal suppresses the migrated prompt');
 assert.equal(await page.evaluate(()=>window.fixture.storage['member-map-prompt-seen-v3:synthetic-a'].state.dismissed),true);
 assert.equal(await page.evaluate(()=>window.fixture.shares),0);
 // Failed/absent persistence must not create a popup loop on fresh loads.
 for(const failure of [{failWrite:true},{failRead:true},{noStorage:true},{blockLocalStorage:true}]) {
   await reset(failure);await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();await page.waitForTimeout(50);
   assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'no automatic prompt without durable memory');
   await page.getByRole('button',{name:'Show my avatar',exact:true}).click();await page.getByRole('dialog').waitFor();
   assert.equal(await page.evaluate(()=>window.fixture.shares),0,'manual disclosure never grants location');
 }
 // Late persistence cannot reopen a dismissed/navigated-away surface.
 await reset({deferWrite:true});await page.waitForFunction(()=>!!window.fixture.finishWrite);
 await page.evaluate(()=>{window.fixture.active=false;window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.waitForTimeout(20);
 await page.evaluate(()=>window.fixture.finishWrite());await page.waitForTimeout(50);
 assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'navigation cancels a pending automatic invitation');
 await reset({deferWrite:true});await page.waitForFunction(()=>!!window.fixture.finishWrite);
 await page.evaluate(()=>{window.fixture.finishAutomaticWrite=window.fixture.finishWrite;});
 await page.getByRole('button',{name:'Show my avatar',exact:true}).click();await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'Not now',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.evaluate(()=>window.fixture.finishAutomaticWrite());await page.waitForTimeout(50);
 assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'late automatic persistence cannot undo an explicit dismissal');
 // An already-consented account has completed the invitation, even after a later opt-out.
 await reset({location:{loading:false,busy:false,error:null,needsLocationStop:false,sharing:true,settings:{sessionKey:'session-a',sessionExpiresAt:'2099-01-01T00:00:00Z',locationEnabled:true,eventsMapEnabled:true,consentVersion:'events-map-account-v3',revision:4,shareUntil:null}}});
 await page.getByRole('button',{name:'Stop sharing',exact:true}).waitFor();await page.waitForTimeout(20);
 const completedStorage=await page.evaluate(()=>window.fixture.storage);
 await reset({storage:completedStorage});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();await page.waitForTimeout(50);
 assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'previously completed invitation stays quiet after opt-out/reload');
 // Unknown settings must not falsely claim the owner has not consented.
 if(!native){
 await reset({entry:false,location:{loading:true,busy:false,error:null,needsLocationStop:false,sharing:false,settings:null}});
 await page.getByText('Checking your saved sharing preference…',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Show my avatar',exact:true}).count(),0,'loading is not an opt-out');
 await page.evaluate(()=>{window.fixture.location={loading:false,busy:false,error:null,needsLocationStop:false,sharing:true,settings:{sessionKey:'session-a',sessionExpiresAt:'2099-01-01T00:00:00Z',locationEnabled:true,eventsMapEnabled:true,consentVersion:'events-map-account-v3',revision:4,shareUntil:'2099-01-01T00:00:00Z'}};window.fixture.version++;dispatchEvent(new Event('fixturechange'));});
 await page.getByRole('button',{name:'Stop sharing',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Show my avatar',exact:true}).count(),0,'restored current-session consent never offers duplicate opt-in');
 assert.equal(await page.evaluate(()=>window.fixture.shares),0);
 await reset({entry:false});
 await page.getByText(/Show your avatar across devices and future sign-ins/).waitFor();
 assert.equal(await page.evaluate(()=>window.fixture.shares),0,'explanation cannot silently transfer consent');
 }
 // Legacy sharing is never silently widened. An explicit upgrade opens disclosure.
 await reset({entry:false,location:{loading:false,busy:false,error:null,needsLocationStop:false,sharing:true,settings:{sessionKey:'session-a',sessionExpiresAt:'2099-01-01T00:00:00Z',locationEnabled:true,eventsMapEnabled:true,consentVersion:'events-map-session-v2',revision:4,shareUntil:'2099-01-01T00:00:00Z'}}});
 await page.getByRole('button',{name:'Use across devices',exact:true}).click();
 await page.getByRole('dialog').waitFor();
 assert.equal(await page.evaluate(()=>window.fixture.shares),0,'scope change waits for explicit disclosure confirmation');
 // Ineligible/error state fails closed; successful existing sharing never re-prompts.
 await reset({map:false,location:{loading:false,busy:false,error:null,needsLocationStop:false,sharing:true,settings:{sessionKey:'session-a',sessionExpiresAt:'2099-01-01T00:00:00Z',locationEnabled:true,eventsMapEnabled:true,revision:4,shareUntil:new Date(Date.now()+3600000).toISOString()}}});await page.waitForTimeout(50);assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false);assert.equal(await page.evaluate(()=>window.fixture.shares),0);
 if(!native){await reset();await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.length===new Set(ids).size}),true,'entry/map dialog labels have unique IDs');}
 assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: mounted web/native disclosure, explicit action, Not now cooldown/remount, owner isolation, expiry, provider disabled, withdrawal retry, web focus/Escape');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
