const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const mocks = {
  '@dvnt/app/lib/mmkv-zustand': `export const mmkvStorage={getItem:k=>window.fixture.storage[k]||null,setItem:(k,v)=>{window.fixture.storage[k]=v}};`,
  '@dvnt/app/lib/stores/auth-store': `import {useSyncExternalStore} from 'react';export const useAuthStore=s=>useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>s({user:window.fixture.owner?{authId:window.fixture.owner}:null}));`,
  '@dvnt/app/lib/hooks/use-member-map': `import {useSyncExternalStore} from 'react';function tick(){useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>window.fixture.version)}export function useLocationSettings(){tick();return {...window.fixture.location,setSharing:async n=>{window.fixture.stops.push(n)},setOverall:async n=>{window.fixture.overall.push(n)},refresh:async()=>{}}}export function useMapSharingConsent(){tick();return {busy:false,error:window.fixture.error,share:async()=>{window.fixture.shares++;return window.fixture.result},cancel:()=>{window.fixture.cancels++}}}`,
  'react-native': `import React from 'react';export const View=({children,...p})=><div>{children}</div>;export const ScrollView=View;export const Text=({children,accessibilityRole})=><p role={accessibilityRole==='header'?'heading':accessibilityRole}>{children}</p>;export const Pressable=({children,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{children}</button>;export const Modal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;`,
};
async function bundle(native) {
  return build({stdin:{contents:`import React,{useSyncExternalStore} from 'react';import {createRoot} from 'react-dom/client';import {MapSharingConsent} from './packages/app/features/events/ui/map-sharing-consent${native?'':'.web'}.tsx';function App(){useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>window.fixture.version);return window.fixture.mounted?<>{window.fixture.entry!==false?<MapSharingConsent active={window.fixture.active} promptOnly/>:null}{window.fixture.map!==false?<MapSharingConsent active={window.fixture.active}/>:null}</>:null}createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',nodePaths:[process.env.NODE_PATH||path.join(root,'node_modules')],plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>{if(mocks[a.path])return {path:a.path,namespace:'mock'};});b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}));}}]});
}
(async()=>{
 const outputs=await Promise.all([bundle(false),bundle(true)]);
 if(process.argv.includes('--build-only')){console.log('PASS: web and native consent UI fixtures compile');return;}
 const browser=await (process.env.MAP_BROWSER==='webkit'?webkit:chromium).launch({headless:true});
 try {
 for(const native of [false,true]) {
 const page=await browser.newPage({viewport:{width:393,height:852}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function reset(extra={}){await page.goto('about:blank');await page.setContent('<div id="root"></div>');await page.evaluate(extra=>{window.fixture={owner:'synthetic-a',active:true,mounted:true,version:0,storage:{},shares:0,cancels:0,stops:[],overall:[],result:false,error:null,location:{loading:false,busy:false,error:null,needsLocationStop:false,sharing:false,settings:{locationEnabled:false,eventsMapEnabled:false,revision:0,shareUntil:null}},...extra};},extra);await page.addScriptTag({content:outputs[Number(native)].outputFiles[0].text});}
 await reset();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('dialog').count(),1,'entry and map mount only one visible dialog');assert.equal(await page.evaluate(()=>window.fixture.shares),0,'opening disclosure never requests location');
 assert.match(await page.getByRole('dialog').innerText(),/about 1 km/);assert.match(await page.getByRole('dialog').innerText(),/eligible nearby DVNT members for 4 hours/);assert.match(await page.getByRole('dialog').innerText(),/15 minutes/);
 if(!native)assert.equal(await page.getByRole('button',{name:'Not now',exact:true}).evaluate(e=>document.activeElement===e),true,'focus starts on safe dismissal');
 await page.getByRole('button',{name:'Not now',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.fixture.shares),0);
 await page.evaluate(()=>{window.fixture.mounted=false;window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.waitForTimeout(20);
 await page.evaluate(()=>{window.fixture.mounted=true;window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'remount honors account cooldown');
 const savedStorage=await page.evaluate(()=>window.fixture.storage);await reset({storage:savedStorage});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'fresh page load honors durable cooldown');
 await page.getByRole('button',{name:'Show my avatar',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Share my location',exact:true}).click();assert.equal(await page.evaluate(()=>window.fixture.shares),1,'explicit share is only permission entry');
 if(!native){await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});}else await page.getByRole('button',{name:'Not now',exact:true}).click();
 await page.evaluate(()=>{window.fixture.owner='synthetic-b';window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>window.fixture.shares),1,'account switch never reuses positive consent');
 await page.evaluate(()=>{window.fixture.owner=null;window.fixture.version++;dispatchEvent(new Event('fixturechange'));});await page.getByRole('dialog').waitFor({state:'detached'});
 await reset({location:{loading:false,busy:false,error:null,needsLocationStop:false,sharing:false,settings:{locationEnabled:true,eventsMapEnabled:true,revision:3,shareUntil:'2000-01-01T00:00:00Z'}}});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false,'expired grant never auto-prompts or renews');assert.equal(await page.evaluate(()=>window.fixture.shares),0);
 await reset({active:false});await page.getByRole('button',{name:'Show my avatar',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Show my avatar',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false);
 await reset({map:false,location:{loading:false,busy:false,error:'Withdrawal not confirmed',needsLocationStop:true,sharing:false,settings:{locationEnabled:true,eventsMapEnabled:true,revision:4,shareUntil:null}}});await page.getByRole('button',{name:'Turn all location off',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.fixture.overall),[false]);
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
 // Ineligible/error state fails closed; successful existing sharing never re-prompts.
 await reset({map:false,location:{loading:false,busy:false,error:null,needsLocationStop:false,sharing:true,settings:{locationEnabled:true,eventsMapEnabled:true,revision:4,shareUntil:new Date(Date.now()+3600000).toISOString()}}});await page.waitForTimeout(50);assert.equal(await page.getByRole('dialog').isVisible().catch(()=>false),false);assert.equal(await page.evaluate(()=>window.fixture.shares),0);
 if(!native){await reset();await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.length===new Set(ids).size}),true,'entry/map dialog labels have unique IDs');}
 assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: mounted web/native disclosure, explicit action, Not now cooldown/remount, owner isolation, expiry, provider disabled, withdrawal retry, web focus/Escape');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
