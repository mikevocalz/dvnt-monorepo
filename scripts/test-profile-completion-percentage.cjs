// Mount both real cards and their real owner-presence hook. Only app/platform
// boundaries and Supabase IO are fixtures; no real accounts or writes occur.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('@playwright/test')); }
const ROOT = path.resolve(__dirname, '..');
const boundaries = {
  'completion-fixture': `import {useSyncExternalStore} from 'react';
    const listeners=new Set();let revision=0;
    const base={id:'7',authId:'fixture-owner',username:'fixture',email:'fixture@example.test',name:'Fixture',avatar:'https://example.test/a.jpg',bio:'Hello',location:'City',website:'https://example.test',isVerified:true,postsCount:1,followersCount:0,followingCount:0};
    export const state={user:base,profile:base,mounted:true,hydrated:false,authenticated:false,status:'loading'};
    export const useValue=select=>{useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision);return select(state)};
    export const snapshot=()=>({user:state.user,_hasHydrated:state.hydrated,isAuthenticated:state.authenticated,authStatus:state.status});
    const update=patch=>{Object.assign(state,patch);window.fixture.currentUser=state.user;revision++;for(const fn of listeners)fn()};
    window.fixture={requests:[],navigations:[],nudges:0,base,update,currentUser:base};`,
  '@dvnt/app/lib/stores/auth-store': `import {useValue,snapshot} from 'completion-fixture';export const useAuthStore=select=>useValue(()=>select(snapshot()));useAuthStore.getState=snapshot;`,
  '@dvnt/app/lib/stores/onboarding-v2-store': `const requestNudge=()=>window.fixture.nudges++;export const useOnboardingV2Store=select=>select({requestNudge});`,
  '@dvnt/app/lib/supabase/client': `export const supabase={from:table=>({select:fields=>({eq:(column,id)=>({maybeSingle:()=>new Promise((resolve,reject)=>window.fixture.requests.push({table,fields,column,id,resolve,reject}))})})})};`,
  'lucide-react': 'export const ChevronRight=()=>null;',
  'lucide-react-native': 'export const ChevronRight=()=>null;',
  'expo-router': 'export const router={push:value=>window.fixture.navigations.push(value)};',
  'react-native': `import React from 'react';export const View=({children,...props})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const Pressable=({children,onPress})=><button onClick={onPress}>{children}</button>;`,
  'react-native-svg': `import React from 'react';export default function Svg({children}){return <svg>{children}</svg>}export const Circle=()=>null;`,
};
(async()=>{
  const build=await esbuild.build({
    stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {useValue} from 'completion-fixture';
      import {ProfileCompletionCard as WebCard} from './packages/app/components/profile-completion-card.web';
      import {ProfileCompletionCard as NativeCard} from './packages/app/components/profile-completion-card.native';
      import {useProfileCompletion,refreshProfileCompletionPresence} from './packages/app/lib/hooks/use-profile-completion';
      import {hydrateAuthProfile} from './packages/app/lib/auth/hydrate-auth-profile';
      import {publishSessionBoundary,getSessionLifecycle} from './packages/app/lib/auth/session-lifecycle';
      const client=new QueryClient({defaultOptions:{queries:{retryDelay:0}}});window.fixture.client=client;window.fixture.session=publishSessionBoundary;window.fixture.lifecycle=getSessionLifecycle;window.fixture.refresh=()=>refreshProfileCompletionPresence(client,window.fixture.currentUser);window.fixture.hydrate=hydrateAuthProfile;
      function Cards(){const profile=useValue(s=>s.profile);const completion=useProfileCompletion(profile);return <><output id="score">{completion?.percent ?? 'unknown'}</output><section id="web"><WebCard profile={profile} onJump={p=>window.fixture.navigations.push(p)}/></section><section id="native"><NativeCard profile={profile}/></section></>}
      function Fixture(){const mounted=useValue(s=>s.mounted);return <QueryClientProvider client={client}>{mounted?<Cards/>:null}</QueryClientProvider>}
      createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:ROOT,loader:'tsx'},
    bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    tsconfigRaw:{compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}},
    nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),
    define:{'process.env.NODE_ENV':'"test"'},
    plugins:[{name:'completion-boundaries',setup(build){
      build.onResolve({filter:/.*/},args=>{
        if(Object.hasOwn(boundaries,args.path))return {path:args.path,namespace:'fixture'};
        if(args.path.startsWith('@dvnt/app/'))return {path:path.join(ROOT,'packages/app',args.path.slice('@dvnt/app/'.length)+'.ts')};
      });
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:boundaries[args.path],loader:'tsx',resolveDir:ROOT}));
    }}],
  });
  const server=http.createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(build.outputFiles[0].contents)}
    res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const waitRequests=count=>page.waitForFunction(n=>window.fixture.requests.length>=n,count);
    const score=value=>page.waitForFunction(v=>document.querySelector('#score')?.textContent===String(v),value);
    const resolve=(index,present)=>page.evaluate(({index,present})=>window.fixture.requests[index].resolve({data:{gender:'',sexuality:present?['fixture-choice']:[],event_audience:present?'fixture-audience':''},error:null}),{index,present});
    const update=patch=>page.evaluate(p=>window.fixture.update(p),patch);
    const hidden=async()=>{assert.equal(await page.locator('#web').innerText(),'');assert.equal(await page.locator('#native').innerText(),'');};
    await score('unknown');await hidden();
    assert.equal(await page.evaluate(()=>window.fixture.requests.length),0,'persisted user cannot start a private read before authenticated hydration');
    await update({hydrated:true,authenticated:true,status:'authenticated'});
    await waitRequests(1);await score('unknown');await hidden();
    // Reproduces the incomplete whitelist retained by an old login. The actual
    // cards recover to 100 from the owner's saved fields without editing them.
    await resolve(0,true);await score(100);await hidden();
    assert.equal(await page.evaluate(()=>window.fixture.requests.length),1,'cards deduplicate the owner read');
    // A public/provider refresh lacking private fields cannot regress to 70.
    await page.evaluate(()=>window.fixture.update({user:{...window.fixture.base},profile:{...window.fixture.base}}));
    await score(100);await hidden();
    // A genuine missing response still produces both exact checklist deficits.
    await page.evaluate(()=>{void window.fixture.refresh()});
    await waitRequests(2);await resolve(1,false);await score(70);
    assert.match(await page.locator('#web').innerText(),/70%/);assert.match(await page.locator('#native').innerText(),/70%/);
    assert.match(await page.locator('#web').innerText(),/Tell us who you are/);
    assert.match(await page.locator('#web').innerText(),/Choose who you want events with/);
    await page.locator('#web button').first().click();
    assert.equal(await page.evaluate(()=>window.fixture.navigations[0]),'/feed/profile/edit?focus=identity');
    // A confirmed save + refetch reaches 100 and hides both mounted cards.
    await page.evaluate(()=>{void window.fixture.refresh()});
    await waitRequests(3);await resolve(2,true);await score(100);await hidden();
    // Account switches cannot borrow a complete score or accept a late read.
    await page.evaluate(()=>window.fixture.update({user:{...window.fixture.base,id:'8',authId:'fixture-b'},profile:{...window.fixture.base,id:'8'}}));
    await waitRequests(4);await score('unknown');await hidden();
    await page.evaluate(()=>window.fixture.update({user:{...window.fixture.base,id:'9',authId:'fixture-c'},profile:{...window.fixture.base,id:'9'}}));
    await waitRequests(5);await resolve(3,true);await score('unknown');await hidden();
    await resolve(4,false);await score(70);
    // Logout hides the previous owner's result immediately.
    await update({user:null,profile:null});await score('unknown');await hidden();
    // A denied/offline read never masquerades as missing required information.
    await page.evaluate(()=>window.fixture.update({user:{...window.fixture.base,id:'10',authId:'fixture-d'},profile:{...window.fixture.base,id:'10'}}));
    await waitRequests(6);await page.evaluate(()=>window.fixture.requests[5].resolve({data:null,error:{code:'42501'}}));
    await waitRequests(7);await page.evaluate(()=>window.fixture.requests[6].resolve({data:null,error:{code:'42501'}}));
    await page.waitForFunction(()=>window.fixture.client.getQueryState(['profileCompletionPresence','10','fixture-d',window.fixture.lifecycle().epoch])?.status==='error');
    await score('unknown');await hidden();
    // Returning to a profile forces fresh owner presence and does not flash an
    // old percentage from an earlier visit or persisted auth snapshot.
    await update({mounted:false});await page.waitForFunction(()=>!document.querySelector('#score'));
    await update({mounted:true});await waitRequests(8);await score('unknown');await hidden();
    await resolve(7,true);await score(100);await hidden();
    // A save during the very first read must cancel that pre-save request,
    // even though TanStack has not cached data yet.
    await page.evaluate(()=>window.fixture.update({user:{...window.fixture.base,id:'12',authId:'fixture-pending'},profile:{...window.fixture.base,id:'12'}}));
    await waitRequests(9);await score('unknown');
    await page.evaluate(()=>{void window.fixture.refresh()});
    await waitRequests(10);await resolve(9,true);await score(100);await hidden();
    await resolve(8,false);await score(100);await hidden();
    // Batched logout/login to the SAME account must change the query epoch
    // even if React never observes an empty user between those operations.
    await page.evaluate(()=>{window.fixture.session({ready:false});window.fixture.session({ready:true,authId:'fixture-pending'})});
    await waitRequests(11);await score('unknown');await hidden();
    await resolve(10,false);await score(70);
    // A new session whose owner profile has not arrived cannot read the old row.
    await page.evaluate(()=>window.fixture.session({ready:true,authId:'fixture-other'}));
    await score('unknown');await hidden();
    assert.equal(await page.evaluate(()=>window.fixture.requests.length),11);
    await page.evaluate(()=>window.fixture.update({user:{...window.fixture.base,id:'13',authId:'fixture-other'},profile:{...window.fixture.base,id:'13'}}));
    await waitRequests(12);await score('unknown');
    // Even a success from this owner is discarded if its session ends in-flight.
    await page.evaluate(()=>window.fixture.session({ready:false}));
    await resolve(11,true);await score('unknown');await hidden();
    await page.evaluate(()=>window.fixture.session({ready:true,authId:'fixture-other'}));
    await waitRequests(13);await score('unknown');await resolve(12,true);await score(100);await hidden();
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>window.fixture.requests.every(r=>r.fields==='gender, sexuality, event_audience'&&r.column==='id')),true);
    console.log('PASS: real web/native cards, 70→100 recovery, save refresh, public snapshot refresh, unknown/failed reads, logout/account isolation, and revisit.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
