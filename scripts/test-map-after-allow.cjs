const assert = require('node:assert/strict');
const path = require('node:path');
const {build} = require('esbuild');
(async () => {
 const {Window} = await import(require.resolve('happy-dom'));
 const root=path.resolve(__dirname,'..');
 const mocks={
  'solito/navigation': `export const useRouter=()=>({push:p=>window.f.routes.push(p)});`,
  '@dvnt/app/lib/stores/auth-store': `export const useAuthStore={getState:()=>({user:{authId:window.f.owner}})};`,
  '@dvnt/app/lib/stores/events-screen-store': `export const useEventsScreenStore={getState:()=>({setSelectedMapEventId:v=>window.f.selection=v,setShowMapView:v=>window.f.map=v})};`,
 };
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {useMapSharingNavigation} from './packages/app/features/events/ui/use-map-sharing-navigation.web.ts';function App(){window.f.run=useMapSharingNavigation('a',()=>new Promise(r=>window.f.resolve=r));return null;}const root=createRoot(document.getElementById('root'));window.f.unmount=()=>root.unmount();root.render(<App/>);`,resolveDir:root,loader:'tsx'},nodePaths:[process.env.NODE_PATH],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 async function test(url, change, result, expected){const w=new Window({url,console,settings:{enableJavaScriptEvaluation:true}});w.document.body.innerHTML='<div id="root"></div>';w.f={owner:'a',routes:[],map:false,selection:'old'};Object.defineProperty(w.document,'visibilityState',{value:'visible',configurable:true});w.eval(bundle.outputFiles[0].text);await new Promise(r=>setTimeout(r,20));const pending=w.f.run();assert.equal(w.f.map,false,'never navigate before successful consent');if(change)change(w);w.f.resolve(result);await pending;assert.equal(w.f.map,expected);assert.deepEqual([...w.f.routes],expected && !url.endsWith('/events')?['/events']:[]);if(expected)assert.equal(w.f.selection,null);w.f.unmount();await w.happyDOM.close();}
 await test('https://dvnt.test/',null,true,true);
 await test('https://dvnt.test/settings/privacy',null,true,true);
 await test('https://dvnt.test/events',null,true,true);
 await test('https://dvnt.test/',null,false,false);
 await test('https://dvnt.test/',w=>{w.f.owner='b'},true,false);
 await test('https://dvnt.test/',w=>w.f.unmount(),true,false);
 await test('https://dvnt.test/',w=>w.history.pushState({},'', '/elsewhere'),true,false);
 await test('https://dvnt.test/',w=>Object.defineProperty(w.document,'visibilityState',{value:'hidden'}),true,false);
 console.log('PASS: allow-to-map, no denied/cancelled/stale/account-switched/background redirect; no duplicate Events history');
})().catch(e=>{console.error(e);process.exitCode=1;});
