// Actual WebAppShell + ReactDOM. Auth IO, router and RN DOM boundaries are
// fixtures. Room-only auth services must stay unused on these event routes.
// Verifies redirects, hydration and route changes; not a payment test.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const esbuild=require('esbuild');
const ROOT=path.resolve(__dirname,'..');
const boundaries={
  'route-fixture':`import {useSyncExternalStore} from 'react';
    const listeners=new Set();let revision=0;
    export const state={path:location.pathname,authenticated:false,hydrated:false,publicRoute:false,authStatus:'loading'};
    export const useValue=select=>{useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision);return select(state)};
    export const update=patch=>{Object.assign(state,patch);revision++;for(const fn of listeners)fn()};
    window.fixture={navigations:[],roomServiceCalls:[],update,go:(path,patch={})=>{history.replaceState({},'',path);update({path:location.pathname,...patch})}};
    export const unexpectedRoomService=name=>{window.fixture.roomServiceCalls.push(name);throw new Error('Room-only service invoked on an event route: '+name)};
    export const router={replace:path=>{window.fixture.navigations.push(path);history.replaceState({},'',path);update({path:location.pathname,publicRoute:location.pathname.startsWith('/public/events/')})}};`,
  'solito/navigation':`import {useValue,router} from 'route-fixture';export const usePathname=()=>useValue(s=>s.path);export const useRouter=()=>router;`,
  '@dvnt/app/lib/stores/auth-store':`import {useValue,state,unexpectedRoomService} from 'route-fixture';
    const snapshot=()=>({isAuthenticated:state.authenticated,_hasHydrated:state.hydrated,authStatus:state.authStatus,user:state.authenticated?{id:'fixture-member',authId:'fixture-auth'}:null});
    export const useAuthStore=Object.assign(select=>useValue(()=>select(snapshot())),{getState:snapshot,subscribe:()=>unexpectedRoomService('auth.subscribe')});`,
  '@dvnt/app/lib/auth-client':`import {unexpectedRoomService} from 'route-fixture';export const getSession=()=>unexpectedRoomService('getSession');export const resumeAuthSession=()=>unexpectedRoomService('resumeAuthSession');`,
  '@dvnt/app/lib/api/privileged':`import {unexpectedRoomService} from 'route-fixture';export const syncAuthUser=()=>unexpectedRoomService('syncAuthUser');`,
  '@dvnt/app/lib/auth/hydrate-auth-profile':`import {unexpectedRoomService} from 'route-fixture';export const hydrateAuthProfile=()=>unexpectedRoomService('hydrateAuthProfile');`,
  '@dvnt/app/lib/auth/continuation-guard':`import {unexpectedRoomService} from 'route-fixture';export const captureAuthContinuation=()=>unexpectedRoomService('captureAuthContinuation');`,
  '@dvnt/app/lib/auth/session-lifecycle':`import {unexpectedRoomService} from 'route-fixture';export const getSessionLifecycle=()=>unexpectedRoomService('getSessionLifecycle');`,
  'react-native':`import React from 'react';export const View=({children,...props})=><div {...props}>{children}</div>;export const StyleSheet={create:s=>s};`,
  '@dvnt/app/components/ui/html':`import React from 'react';export const Main=({children,...props})=><main {...props}>{children}</main>;`,
};
(async()=>{
 const built=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {useValue,update} from 'route-fixture';import {WebAppShell} from './packages/app/components/web-app-shell.web';
   function Fixture(){const s=useValue(s=>({...s}));return <><button onClick={()=>update({hydrated:true})}>Finish guest hydration</button><output id="path">{s.path}</output><WebAppShell requireAuth={!s.publicRoute}><h1>Fixture event route</h1></WebAppShell></>}
   createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:ROOT,loader:'tsx'},
   bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}},
   nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),define:{'process.env.NODE_ENV':'"test"'},
   plugins:[{name:'explicit-route-fixtures',setup(build){
     build.onResolve({filter:/.*/},args=>{
       if(Object.hasOwn(boundaries,args.path))return{path:args.path,namespace:'fixture'};
       if(args.path.startsWith('@dvnt/app/'))return{path:path.join(ROOT,'packages/app',args.path.slice('@dvnt/app/'.length)+'.ts')};
     });
     build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:boundaries[args.path],loader:'tsx',resolveDir:ROOT}));
   }}]});
 const html='<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/bundle.js"></script>';
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?built.outputFiles[0].contents:html)});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const origin=`http://127.0.0.1:${server.address().port}`;
 let browser,dom;
 try{
   if(process.argv.includes('--serve')){console.log('Fixture URL: '+origin+'/feed/events/82?ref=HOST10&promo=SAVE10');await new Promise(()=>{});return}
   let evaluate;
   if(process.argv.includes('--dom')){
     const {JSDOM}=require('jsdom');dom=new JSDOM(html,{url:origin+'/feed/events/82?ref=HOST10&promo=SAVE10',runScripts:'outside-only',pretendToBeVisual:true});
     dom.window.eval(built.outputFiles[0].text);evaluate=async(fn,arg)=>dom.window.eval(`(${fn.toString()})(${JSON.stringify(arg)})`);
   }else{
     let chromium;try{({chromium}=require('playwright'))}catch{({chromium}=require('@playwright/test'))}
     browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const page=await browser.newPage();
     await page.goto(origin+'/feed/events/82?ref=HOST10&promo=SAVE10');evaluate=(fn,arg)=>page.evaluate(fn,arg);
   }
   const wait=async(fn)=>{const start=Date.now();while(!await evaluate(fn)){if(Date.now()-start>5000)throw Error('Fixture timeout: '+fn);await new Promise(r=>setTimeout(r,5))}};
   const go=async(path,patch={})=>evaluate(({path,patch})=>window.fixture.go(path,patch),{path,patch});
   const update=async patch=>evaluate(p=>window.fixture.update(p),patch);
   const current=()=>evaluate(()=>location.pathname+location.search);
   const assertNoRoomServices=async context=>assert.equal(await evaluate(()=>window.fixture.roomServiceCalls.length),0,context+': no room-only auth/bootstrap services');
   await wait(()=>document.querySelector('#path'));
   assert.equal(await current(),'/feed/events/82?ref=HOST10&promo=SAVE10');
   assert.equal(await evaluate(()=>window.fixture.navigations.length),0,'hydration cannot redirect an unknown session');
   assert.equal(await evaluate(()=>!!document.querySelector('h1')),false,'protected children must not mount before auth hydration');
   await assertNoRoomServices('initial legacy event hydration');
   await update({hydrated:true});await wait(()=>location.pathname==='/public/events/82');
   await wait(()=>document.querySelector('h1'));
   assert.equal(await current(),'/public/events/82?ref=HOST10&promo=SAVE10');
   assert.equal(await evaluate(()=>window.fixture.navigations.length),1,'public route has no redirect loop');
   await assertNoRoomServices('guest public event');
   // A newer legacy event visit must update the destination even in the same shell.
   await go('/feed/events/83?ref=OTHER&next=https://evil.invalid',{publicRoute:false});
   await wait(()=>location.pathname==='/public/events/83');assert.equal(await current(),'/public/events/83?ref=OTHER');
   await assertNoRoomServices('new legacy event navigation');
   for(const route of ['/feed/events/82/organizer','/feed/events/82/scanner','/feed/events/my-tickets','/feed/checkout/review','/feed/messages']){
     await go(route,{publicRoute:false});await wait(()=>location.pathname==='/');
     await assertNoRoomServices(route);
   }
   // Members retain the existing app route; logout recovers the same event.
   await go('/feed/events/82?promo=KEEP',{authenticated:true,publicRoute:false});
   await wait(()=>document.querySelector('#path')?.textContent==='/feed/events/82');
   await wait(()=>document.querySelector('h1'));
   assert.equal(await current(),'/feed/events/82?promo=KEEP');
   await assertNoRoomServices('member event with room-only authStatus still loading');
   await update({authenticated:false});await wait(()=>location.pathname==='/public/events/82');
   assert.equal(await current(),'/public/events/82?promo=KEEP');
   await assertNoRoomServices('logout preserves public event');
   console.log(`PASS: actual WebAppShell ${process.argv.includes('--dom')?'ReactDOM/jsdom':'Chromium'} hydration, legacy event recovery, query safety, new event navigation, member gates, logout and zero room-bootstrap services.`);
 }finally{await browser?.close();dom?.window.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
