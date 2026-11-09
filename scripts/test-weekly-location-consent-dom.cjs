const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const root = path.resolve(__dirname, '..');
  const mocks = {
    'react-native': `import React from 'react';export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Text=({children})=><p>{children}</p>;export const Pressable=({children,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{children}</button>;export const Modal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;`,
    '@dvnt/app/lib/mmkv-zustand': `export const mmkvStorage={getItem:k=>window.fixture.storage[k]||null,setItem:(k,v)=>{window.fixture.storage[k]=v}};`,
    '@dvnt/app/lib/stores/auth-store': `import {useSyncExternalStore} from 'react';export const useAuthStore=s=>useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>s({user:window.fixture.owner?{authId:window.fixture.owner}:null}));`,
    '@dvnt/app/lib/hooks/use-member-map': `import {useSyncExternalStore} from 'react';function tick(){useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>window.fixture.version)}export function useLocationSettings(){tick();return {...window.fixture.location,setSharing:async()=>{},refresh:async()=>{}}}export function useMapSharingConsent(){tick();return {busy:false,error:null,share:async()=>{window.fixture.shares++;return false},cancel:()=>{}}}`,
  };
  const output=await build({nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),stdin:{contents:`import React,{useSyncExternalStore} from 'react';import {createRoot} from 'react-dom/client';import {MapSharingConsent} from './packages/app/features/events/map-sharing-consent.tsx';function App(){useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>window.fixture.version);return window.fixture.mounted?<><MapSharingConsent active={window.fixture.active} promptOnly/><MapSharingConsent active={window.fixture.active}/></>:null}const root=createRoot(document.getElementById('root'));window.fixture.unmount=()=>root.unmount();root.render(<React.StrictMode><App/></React.StrictMode>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}));}}]});
  const win=new Window({url:'https://fixture.test',console,settings:{enableJavaScriptEvaluation:true}});
  win.document.body.innerHTML='<div id="root"></div>';
  win.fixture={owner:'viewer',version:0,mounted:true,active:true,shares:0,storage:{},location:{loading:false,busy:false,error:null,needsLocationStop:false,sharing:false,settings:{sessionKey:'session-a',sessionExpiresAt:'2099-01-01T00:00:00Z',locationEnabled:true,eventsMapEnabled:true,shareUntil:'2000-01-01T00:00:00Z'}}};
  const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.ok(fn());};
  const tick=()=>{win.fixture.version++;win.dispatchEvent(new win.Event('fixturechange'));};
  const dialog=()=>win.document.querySelector('[role=dialog]');
  const button=text=>[...win.document.querySelectorAll('button')].find(b=>b.textContent===text);
  try {
    win.eval(output.outputFiles[0].text);
    await wait(()=>!!dialog());
    assert.equal(win.document.querySelectorAll('[role=dialog]').length,1);
    assert.equal(win.fixture.shares,0,'expired grants get an invitation, not silent renewal');
    assert.match(dialog().textContent,/this sign-in/);
    button('Not now').click();
    await wait(()=>!dialog());
    win.fixture.mounted=false;tick();await wait(()=>!button('Show my avatar'));
    win.fixture.mounted=true;tick();await wait(()=>!!button('Show my avatar'));
    assert.equal(dialog(),null,'same-session remount honors dismissal');
    button('Show my avatar').click();await wait(()=>!!dialog());
    button('Share my location').click();await wait(()=>win.fixture.shares===1);
    win.fixture.active=false;tick();await wait(()=>!dialog());
    win.fixture.owner=null;tick();await wait(()=>!button('Show my avatar'));
    win.fixture.owner='other';win.fixture.active=true;tick();await wait(()=>!!dialog());
    assert.equal(win.fixture.shares,1,'account switch never reuses another owner consent');
    button('Not now').click();await wait(()=>!dialog());
    win.fixture.location.settings={...win.fixture.location.settings,sessionKey:'new-signin'};
    tick();await wait(()=>!!dialog());
    assert.equal(win.fixture.shares,1,'same-account new sign-in asks again without sharing silently');
    console.log('PASS: mounted native disclosure renews only by explicit action, preserves cooldown, cancels on inactivity, isolates accounts, and keeps session-bound disclosure');
  } finally {win.fixture.unmount?.();await win.happyDOM.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
