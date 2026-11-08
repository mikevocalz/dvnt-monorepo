#!/usr/bin/env node
/** Actual production web create UI + shared queries. Service/DOM boundaries adapted; no live mutations. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const browserMode = process.argv.includes('--browser');
const resolve = name => require.resolve(name, { paths: [ROOT, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)] });
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function extractFunction(file, name) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  const walk = node => { if (ts.isFunctionDeclaration(node) && node.name?.getText(ast) === name) result = node.getText(ast); ts.forEachChild(node, walk); };
  walk(ast); assert.ok(result, name); return result;
}
(async () => {
  const { Window } = await import(resolve('happy-dom'));
  const window = new Window({ url: 'https://fixture.invalid/feed/sneaky-lynk/create' });
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const f = global.__lynkCreateFixture = { creates: [], searches: [], history: [], navigations: [], toasts: [], searchFails: false, listFails: false, list: [], membershipError: false, membershipRetries: 0 };
  const discoverySource = extractFunction(path.join(ROOT, 'packages/app/features/messages/messages.web.tsx'), 'SneakyLynkTab');
  const bundle = await require(resolve('esbuild')).build({
    stdin: { resolveDir: ROOT, loader: 'tsx', contents: `
      import React, {act} from 'react'; import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {SneakyLynkCreateScreen} from './packages/app/features/sneaky-lynk/screens/create.web';
      import {useCreateLynkStore} from './packages/app/features/sneaky-lynk/stores/create-store';
      import {useLynkDiscovery as useProductionLynkDiscovery} from './packages/app/features/sneaky-lynk/hooks/useLynkDiscovery';
      import {publishSessionBoundary,getSessionLifecycle} from './packages/app/lib/auth/session-lifecycle';
      import {create} from 'zustand';
      const useMessagesTabStore=create(()=>({search:''}));
      function useLynkDiscovery(...args){const result=useProductionLynkDiscovery(...args);globalThis.__discoveryProbe=result;return result;}
      import {discoveryRoomState} from './packages/app/features/sneaky-lynk/discovery-room-state';
      import {useLynkInviteSearch} from './packages/app/features/sneaky-lynk/hooks/useLynkInviteSearch';
      import {useAuthStore} from '@dvnt/app/lib/stores/auth-store';
      import {useUIStore} from '@dvnt/app/lib/stores/ui-store';
      import {useRouter} from 'solito/navigation';
      import {Radio,Plus,RefreshCw,Lock,Globe,Video,Headphones,ArrowUpRight} from 'lucide-react';
      ${discoverySource}
      const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:60_000,retryDelay:1}}});
      export {act,useCreateLynkStore,useAuthStore,client,publishSessionBoundary,getSessionLifecycle,useMessagesTabStore,discoveryRoomState};
      function SearchProbe({query,enabled=true}){const search=useLynkInviteSearch({query,enabled,selfIds:['me'],invitees:[]});globalThis.__searchProbe=search;return <div>{search.isSearching?'searching':search.isError?'error':search.isEmpty?'empty':search.results.map(u=>u.username).join(',')}</div>}
      export function mount(node){const root=createRoot(node);return {render:(screen,props={})=>root.render(<QueryClientProvider client={client}>{screen==='create'?<SneakyLynkCreateScreen/>:screen==='discovery'?<SneakyLynkTab/>:<SearchProbe {...props}/>}</QueryClientProvider>),unmount:()=>root.unmount()};}
    ` },
    bundle: true, write: false, platform: browserMode ? 'browser' : 'node', format: browserMode ? 'iife' : 'cjs', globalName: browserMode ? 'fixtureApp' : undefined, jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
    plugins: [{ name: 'service-boundaries', setup(build) {
      // Keep production hook logic intact; adapt only its platform timer boundary.
      // Other React/Query timers remain real so clock advances never flush a query for us.
      build.onLoad({ filter: /[\\/]hooks[\\/]useLynkDiscovery\.ts$/ }, ({path:file}) => ({loader:'ts',contents:`
        const setTimeout=(callback,delay)=>{const driver=globalThis.__lynkCreateFixture.discoveryClock;
          if(!driver)return {native:globalThis.setTimeout(callback,delay)};
          const id=++driver.next;driver.timers.set(id,{at:driver.now+delay,callback});return {driver,id};};
        const clearTimeout=handle=>{if(handle.driver)handle.driver.timers.delete(handle.id);else globalThis.clearTimeout(handle.native);};
      `+fs.readFileSync(file,'utf8')}));
      build.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|zustand(?:\/.*)?|@tanstack\/react-query)$/ }, ({path:name}) => ({path:resolve(name),external:!browserMode && name !== '@tanstack/react-query'}));
      build.onResolve({ filter: /^(react-native|solito\/navigation|lucide-react|@dvnt\/ui|@dvnt\/app\/lib\/stores\/(?:ui-store|auth-store)|@dvnt\/app\/lib\/subscription\/use-entitlements|@dvnt\/app\/lib\/hooks\/use-verified-gate|@dvnt\/app\/lib\/api\/users|@dvnt\/app\/lib\/auth\/identity)$/ }, ({path:name}) => browserMode && name==='lucide-react' ? ({path:resolve(name)}) : ({path:name,namespace:'fixture'}));
      build.onResolve({ filter: /(?:api\/supabase|stores\/lynk-history-store)$/ }, ({path:name}) => ({path:name,namespace:'fixture'}));
      build.onResolve({ filter: /^@dvnt\/app\// }, ({path:name}) => ({path:path.join(ROOT,'packages/app',name.slice('@dvnt/app/'.length)+'.ts')}));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path:name}) => {
        let contents;
        if (name==='react-native') contents=`export const AppState={addEventListener:(name,listener)=>{globalThis.__nativeDiscoveryWake=listener;return {remove(){}}}};`;
        else if (name==='lucide-react') contents=`export const ArrowLeft=()=>null,Radio=()=>null,Video=()=>null,Globe=()=>null,Lock=()=>null,UserPlus=()=>null,X=()=>null,Plus=()=>null,Smartphone=()=>null,Loader2=()=>null,AlertCircle=()=>null,RefreshCw=()=>null,Headphones=()=>null,ArrowUpRight=()=>null;`;
        else if (name==='@dvnt/ui') contents=`import React from 'react';export const FormField=({children,label,htmlFor})=><div><label htmlFor={htmlFor}>{label}</label>{children}</div>;`;
        else if (name==='solito/navigation') contents=`export const useRouter=()=>({push:target=>globalThis.__lynkCreateFixture.navigations.push(target),back:()=>{}});`;
        else if (name.endsWith('auth-store')) contents=`import {create} from 'zustand';export const useAuthStore=create((set)=>({user:{id:'me',authId:'auth-me',username:'owner'},updateUser:updates=>set(state=>({user:{...state.user,...updates}}))}));`;
        else if (name.endsWith('ui-store')) contents=`export const useUIStore=selector=>selector({showToast:(...args)=>globalThis.__lynkCreateFixture.toasts.push(args)});`;
        else if (name.endsWith('use-entitlements')) contents=`export const useEntitlements=()=>({entitlements:{planKey:'free',maxParticipants:5,sessionMinutes:15,monthlyHostSessions:3},isLoading:false,isError:globalThis.__lynkCreateFixture.membershipError,refetch:()=>globalThis.__lynkCreateFixture.membershipRetries++});`;
        else if (name.endsWith('use-verified-gate')) contents=`export const useVerifiedGate=()=>((_,fn)=>{const f=globalThis.__lynkCreateFixture;if(f.pauseVerification)f.acceptVerification=fn;else fn();});`;
        else if (name.endsWith('lynk-history-store')) contents=`import {create} from 'zustand';export const useLynkHistoryStore=create(()=>({rooms:[],addRoom:room=>globalThis.__lynkCreateFixture.history.push(room)}));globalThis.__historyFixture=useLynkHistoryStore;`;
        else if (name.endsWith('auth/identity')) contents=`export const getCurrentUserRow=()=>{const f=globalThis.__lynkCreateFixture;f.identityCalls=(f.identityCalls||0)+1;return new Promise(resolve=>{f.finishIdentity=resolve;});};`;
        else if (name.endsWith('api/users')) contents=`export const usersApi={searchUsers:(term)=>{const f=globalThis.__lynkCreateFixture;f.searches.push(term);if(f.searchFails)return Promise.reject(new Error('network'));return new Promise(resolve=>{f.finishSearch=resolve;});}};`;
        else if (name.endsWith('api/supabase')) contents=`export const sneakyLynkApi={createRoom:(params,options)=>{const f=globalThis.__lynkCreateFixture;f.creates.push(params);f.createGuard=options.isCurrent;return new Promise(resolve=>{f.finishCreate=resolve;});},getLiveRooms:(options)=>{const f=globalThis.__lynkCreateFixture;f.listCalls=(f.listCalls||0)+1;f.listGuard=options.isCurrent;const start=Date.now(),mono=performance.now();const result=rooms=>rooms.map(room=>({...room,requestStartedAt:start,requestStartedMonotonic:mono}));if(f.deferLists)return new Promise(resolve=>{f.finishList=rooms=>resolve(result(rooms));});return f.listFails?Promise.reject(new Error('offline')):Promise.resolve(result(f.list));}};`;
        else throw Error('Unmocked '+name);
        return {loader:'tsx',contents};
      });
    } }],
  });
  if (browserMode) {
    const http=require('node:http');
    const twRoot=path.dirname(resolve('tailwindcss/package.json'));
    const cssInput=`@import "${twRoot}/theme.css" layer(theme);@import "${twRoot}/preflight.css" layer(base);@import "${twRoot}/utilities.css" important;@source "${ROOT}/packages/app/features/sneaky-lynk";@source "${ROOT}/packages/app/features/messages/messages.web.tsx";`;
    const css=await require(resolve('postcss'))([require(resolve('@tailwindcss/postcss'))({base:ROOT})]).process(cssInput,{from:path.join(ROOT,'lynk-discovery-fixture.css')});
    const server=http.createServer((req,res)=>{
      if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
      else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css.css);}
      else {res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#06070d;color:white;font-family:Arial,sans-serif}#root{max-width:960px;margin:0 auto}</style></head><body><div id="root"></div><script>globalThis.__lynkCreateFixture=${JSON.stringify(f)};</script><script src="/bundle.js"></script><script>window.renderer=fixtureApp.mount(document.getElementById('root'));renderer.render('create');</script></body></html>`);}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const output=process.env.LYNK_DISCOVERY_OUTPUT||'/tmp/lynk-discovery-rendered';fs.mkdirSync(output,{recursive:true});
    let browser;
    try {
      browser=await require(resolve('@playwright/test')).chromium.launch({headless:true});
      for(const [width,height] of [[320,568],[393,852],[1280,900]]) {
        const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('Set the tone.').waitFor();
        await page.evaluate(()=>fixtureApp.useCreateLynkStore.setState({title:'A long, late-night conversation with your favourite people',isPublic:false,hasVideo:true,appOnly:true,invitees:[{id:'1',authId:'one',username:'a_very_long_username_that_should_never_overflow_the_screen',avatar:''}]}));
        await page.waitForTimeout(50);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'create no horizontal overflow at '+width);
        const switches=await page.locator('[role="switch"]').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
        assert.ok(switches.every(rect=>rect.width>=44&&rect.height>=44),'switch touch targets at '+width);
        await page.getByRole('button',{name:'Start Lynk',exact:true}).scrollIntoViewIfNeeded();
        assert.equal(await page.getByRole('button',{name:'Start Lynk',exact:true}).isEnabled(),true);
        await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(30);
        await page.screenshot({path:path.join(output,`create-${width}.png`),fullPage:true});
        await page.evaluate(()=>{const f=globalThis.__lynkCreateFixture;f.list=Array.from({length:4},(_,i)=>({id:'room-'+i,title:i===0?'AVeryLongUnbrokenRoomTitleThatMustWrapAndNeverPushTheCardsPastThePhoneEdge':'After hours, good company',topic:'Music, ideas and whatever comes next. An open conversation to end the evening.',isLive:i!==1,status:i===3?'ended':'open',availability:i===3?'ended':i===1?'inactive':'live',isInvited:i===1,presenceKnown:true,observedAt:new Date().toISOString(),presenceExpiresAt:new Date(Date.now()+90000).toISOString(),isPublic:i%2===0,hasVideo:i%2!==0,listeners:12,maxParticipants:30,createdAt:'2026-11-07T00:00:00Z',host:{id:'host',displayName:'Avery and an unusually long host name',username:'avery',avatar:''},speakers:[],description:''}));renderer.render('discovery');});
        await page.getByRole('region',{name:'Live now'}).waitFor();await page.waitForTimeout(50);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'discovery no horizontal overflow at '+width);
        const cards=await page.locator('button[aria-label$="people."],button[aria-label$="unavailable."]').evaluateAll(nodes=>nodes.map(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right})));
        assert.ok(cards.length>=4&&cards.every(rect=>rect.left>=-1&&rect.right<=width+1),'cards contained at '+width);
        await page.screenshot({path:path.join(output,`discovery-${width}.png`),fullPage:true});
        assert.deepEqual(errors,[],'browser runtime errors at '+width);await page.close();
      }
      console.log('PASS Chromium creation/discovery at 320, 393 and 1280px: long titles/invitees, open/unknown/ended rooms, no horizontal overflow, 44px switches, reachable CTA. Screenshots: '+output);
    } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await window.happyDOM.close();}
    return;
  }
  const module = { exports: {} }; new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
  const app = module.exports;
  const node=document.createElement('div');document.body.append(node);let renderer=app.mount(node);
  const act=fn=>app.act(async()=>{await fn();await tick();});
  const render=(name,props)=>act(()=>renderer.render(name,props));
  const button=text=>[...node.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text);
  const click=text=>act(()=>{const b=button(text);assert.ok(b,text);b.click();});
  const setDraft=values=>act(()=>app.useCreateLynkStore.setState(values));
  const fixtureDeadlineNow=Date.now;
  const waitFor=async(predicate,label)=>{const deadline=fixtureDeadlineNow()+3000;while(!predicate()){assert.ok(fixtureDeadlineNow()<deadline,label);await act(()=>new Promise(resolve=>setTimeout(resolve,5)));}};

  try {
    await render('create');
    assert.equal(button('Start Lynk').disabled,true);
    assert.match(node.textContent,/Current membership/);
    assert.equal(node.querySelector('#lynk-invite-search'),null);
    await setDraft({title:'After hours',isPublic:false,invitees:[{id:'1',authId:'guest',username:'friend',avatar:''}]});
    assert.match(node.textContent,/1 person selected to invite/);
    assert.equal(node.querySelector('[role="switch"][aria-label="Public Lynk"]').getAttribute('aria-checked'),'false','stable public switch is off for private rooms');
    assert.match(node.textContent,/Private · Invited people/);
    assert.equal(node.querySelector('#lynk-invite-search').getAttribute('aria-describedby'),'lynk-search-status');
    await act(()=>{button('Start Lynk').click();button('Start Lynk').click();});
    assert.equal(f.creates.length,1,'same-tick submissions share a synchronous lock');
    assert.deepEqual(f.creates[0].invitedUserIds,['guest'],'selected private invitees reach API');
    assert.equal(node.querySelector('#lynk-title').disabled,true);
    assert.match(node.textContent,/Starting your Lynk/);
    await act(()=>f.finishCreate({ok:false,error:{message:'Try again when online.'}}));
    assert.match(node.querySelector('[role="alert"]').textContent,/Try again when online/);
    assert.equal(node.querySelector('#lynk-title').value,'After hours','failed submit keeps the draft');
    assert.equal(button('Start Lynk').disabled,false);
    await setDraft({isPublic:true});assert.equal(node.querySelector('[role="switch"][aria-label="Public Lynk"]').getAttribute('aria-checked'),'true');await click('Start Lynk');
    assert.deepEqual(f.creates[1].invitedUserIds,[],'switching public excludes selected private invitees');
    await act(()=>f.finishCreate({ok:true,data:{room:{id:4,uuid:'ab123456-1234-1234-1234-123456789012'}}}));
    assert.equal(f.history.length,1);assert.match(f.navigations[0],/ab123456-1234-1234-1234-123456789012/);
    assert.equal(button('Starting your Lynk…').disabled,true,'navigation retains the submit lock');
    await act(()=>renderer.unmount()); renderer=app.mount(node);
    assert.equal(app.useCreateLynkStore.getState().title,'','unmount clears screen draft');
    f.membershipError=true;await render('create');await click('Retry membership check');assert.equal(f.membershipRetries,1);
    await setDraft({title:'Left early'});await click('Start Lynk');
    await act(()=>renderer.unmount());renderer=app.mount(node);
    await act(()=>f.finishCreate({ok:true,data:{room:{id:6}}}));
    assert.equal(f.navigations.length,1,'back/unmount does not navigate after delayed creation');

    await render('create');
    await setDraft({title:'Owner A room',isPublic:false,invitees:[{id:'1',authId:'private-guest',username:'private',avatar:''}]});
    await click('Start Lynk');
    const ownerA=app.useAuthStore.getState().user, finishA=f.finishCreate, guardA=f.createGuard;
    assert.equal(guardA(),true);
    await act(()=>{app.useAuthStore.setState({user:{id:'B'}});app.useAuthStore.setState({user:ownerA});});
    assert.equal(guardA(),false,'batched A to B to A cannot revive an old creation');
    assert.equal(app.useCreateLynkStore.getState().title,'');
    assert.deepEqual(app.useCreateLynkStore.getState().invitees,[],'account change clears private invite selections');
    await setDraft({title:'New account lifetime'});await click('Start Lynk');
    const finishNew=f.finishCreate;
    await act(()=>finishA({ok:true,data:{room:{id:20}}}));
    assert.equal(f.history.length,1,'late old owner response writes no history');assert.equal(f.navigations.length,1);
    assert.equal(button('Starting your Lynk…').disabled,true,'old completion cannot unlock newer create');
    await act(()=>finishNew({ok:false,error:{message:'Retry in this lifetime'}}));
    assert.equal(button('Start Lynk').disabled,false);
    // Capture the real fallback callback, then switch accounts before it fires.
    const oldSetTimeout=global.setTimeout;let fallback;
    global.setTimeout=(fn,ms,...args)=>{if(ms===700)fallback=fn;return oldSetTimeout(fn,ms,...args);};
    try {await click('Start Lynk');await act(()=>f.finishCreate({ok:true,data:{room:{id:21}}}));} finally {global.setTimeout=oldSetTimeout;}
    assert.ok(fallback);let assignments=0;window.location.assign=()=>assignments++;
    await act(()=>app.useAuthStore.setState({user:{id:'B'}}));await act(()=>fallback());
    assert.equal(assignments,0,'old account fallback cannot hard-navigate the new account');
    await act(()=>app.useAuthStore.setState({user:ownerA}));

    // A queued verification callback belongs to the exact account and reviewed form.
    await render('create');f.pauseVerification=true;await setDraft({title:'Reviewed private room',isPublic:false});
    const beforeGate=f.creates.length;await click('Start Lynk');const oldGate=f.acceptVerification;
    await act(()=>{app.useAuthStore.setState({user:{id:'B'}});app.useAuthStore.setState({user:ownerA});});
    await act(()=>oldGate());assert.equal(f.creates.length,beforeGate,'verification cannot revive a previous owner epoch');
    await setDraft({title:'Reviewed title'});await click('Start Lynk');const changedGate=f.acceptVerification;
    await act(()=>node.querySelector('[role="switch"]').click());
    await act(()=>changedGate());assert.equal(f.creates.length,beforeGate,'editing the reviewed form invalidates queued verification');
    await click('Start Lynk');const unmountedGate=f.acceptVerification;
    await act(()=>renderer.unmount());renderer=app.mount(node);await act(()=>unmountedGate());
    assert.equal(f.creates.length,beforeGate,'verification cannot create after leaving');f.pauseVerification=false;

    await render('create');f.pauseVerification=true;await setDraft({title:'Latest review wins'});
    const beforeRepeatedGate=f.creates.length;await click('Start Lynk');const supersededGate=f.acceptVerification;
    await click('Start Lynk');const latestGate=f.acceptVerification;
    await act(()=>latestGate());assert.equal(f.creates.length,beforeRepeatedGate+1);
    await act(()=>f.finishCreate({ok:false,error:{message:'Retry this attempt'}}));
    await act(()=>{supersededGate();latestGate();});
    assert.equal(f.creates.length,beforeRepeatedGate+1,'superseded or consumed verification cannot create after the latest request fails');
    await click('Start Lynk');const afterBackGate=f.acceptVerification;const beforeBackGate=f.creates.length;
    await click('Back');await act(()=>afterBackGate());
    assert.equal(f.creates.length,beforeBackGate,'Back revokes queued verification before route unmount');
    await act(()=>renderer.unmount());renderer=app.mount(node);f.pauseVerification=false;
    await render('create');await setDraft({title:'Leave while creating'});await click('Start Lynk');
    const finishAfterBack=f.finishCreate,historyBeforeBack=f.history.length,routesBeforeBack=f.navigations.length,toastsBeforeBack=f.toasts.length;
    await click('Back');assert.equal(f.createGuard(),false,'Back synchronously revokes pending dispatch even while the DOM remains mounted');
    await act(()=>finishAfterBack({ok:true,data:{room:{id:100}}}));
    assert.equal(f.history.length,historyBeforeBack);assert.equal(f.navigations.length,routesBeforeBack);assert.equal(f.toasts.length,toastsBeforeBack,'late response after Back has no UI side effects');

    await act(()=>renderer.unmount());renderer=app.mount(node);await render('create');
    await setDraft({title:'Back from page cache'});await click('Start Lynk');
    const finishBeforeCache=f.finishCreate,guardBeforeCache=f.createGuard,historyBeforeCache=f.history.length,routesBeforeCache=f.navigations.length;
    await act(()=>window.dispatchEvent(new window.Event('pagehide')));assert.equal(guardBeforeCache(),false);
    await act(()=>{const event=new window.Event('pageshow');Object.defineProperty(event,'persisted',{value:true});window.dispatchEvent(event);});
    await act(()=>window.dispatchEvent(new window.Event('popstate'))); // Real BFCache event order on the restored creation route.
    assert.equal(button('Start Lynk').disabled,false,'BFCache return starts a fresh usable creation lifetime');
    assert.match(node.querySelector('[role="alert"]').textContent,/previous request may have created a Lynk/);
    await click('Start Lynk');const finishAfterCache=f.finishCreate;
    assert.equal(guardBeforeCache(),false,'restoring the page never revives pre-departure work');
    await act(()=>finishBeforeCache({ok:true,data:{room:{id:300}}}));
    assert.equal(f.history.length,historyBeforeCache);assert.equal(f.navigations.length,routesBeforeCache);
    assert.equal(button('Starting your Lynk…').disabled,true,'old BFCache completion cannot unlock the new attempt');
    await act(()=>finishAfterCache({ok:false,error:{message:'Fresh lifetime failed safely'}}));
    assert.equal(button('Start Lynk').disabled,false);
    const originalPath=window.location.pathname;
    await click('Start Lynk');const historyDepartureGuard=f.createGuard,historyDepartureFinish=f.finishCreate;
    await act(()=>{window.history.pushState({},'', '/messages');window.dispatchEvent(new window.Event('popstate'));});
    assert.equal(historyDepartureGuard(),false,'a real history departure revokes pending creation before unmount');
    await act(()=>historyDepartureFinish({ok:false,error:{message:'Old route'}}));
    window.history.replaceState({},'',originalPath);
    await act(()=>{const event=new window.Event('pageshow');Object.defineProperty(event,'persisted',{value:true});window.dispatchEvent(event);window.dispatchEvent(new window.Event('popstate'));});
    f.pauseVerification=true;await click('Start Lynk');const cachedVerification=f.acceptVerification,beforeCachedVerification=f.creates.length;
    await act(()=>window.dispatchEvent(new window.Event('pagehide')));
    await act(()=>{const event=new window.Event('pageshow');Object.defineProperty(event,'persisted',{value:true});window.dispatchEvent(event);});
    await act(()=>window.dispatchEvent(new window.Event('popstate'))); // Real BFCache event order on the restored creation route.
    await act(()=>cachedVerification());assert.equal(f.creates.length,beforeCachedVerification,'BFCache does not revive queued verification');f.pauseVerification=false;

    await render('search',{query:'al'});assert.equal(node.textContent,'searching');
    await act(()=>new Promise(resolve=>setTimeout(resolve,330)));assert.equal(f.searches.at(-1),'al');
    const finishOld=f.finishSearch;
    await render('search',{query:'bea'});await act(()=>new Promise(resolve=>setTimeout(resolve,330)));
    await act(()=>f.finishSearch({docs:[{id:'2',authId:'bea',username:'Bea',avatar:''}]}));assert.equal(node.textContent,'Bea');
    await act(()=>finishOld({docs:[{id:'1',authId:'al',username:'Al',avatar:''}]}));assert.equal(node.textContent,'Bea','older search cannot replace new results');
    f.searchFails=true;await render('search',{query:'fail'});await act(()=>new Promise(resolve=>setTimeout(resolve,350)));assert.equal(node.textContent,'error');
    f.searchFails=false;await act(()=>global.__searchProbe.retry());await act(()=>new Promise(resolve=>setTimeout(resolve,330)));
    await act(()=>f.finishSearch({docs:[]}));assert.equal(node.textContent,'empty','retry resolves error to genuine empty state');
    await render('search',{query:'late'});await render('search',{query:'new'});await act(()=>new Promise(resolve=>setTimeout(resolve,330)));assert.ok(!f.searches.includes('late'),'debounced obsolete request is cancelled');
    await act(()=>f.finishSearch({docs:[]}));

    const room={id:'room-one',title:'Studio hangout',topic:'Music after dark',isLive:true,status:'open',availability:'live',presenceKnown:true,hasVideo:true,isPublic:false,listeners:5,maxParticipants:5,createdAt:'2026-11-07T00:00:00Z',host:{id:'other',displayName:'Bea',username:'bea',avatar:''},speakers:[],description:''};
    const fresh=(overrides={},lease=90_000)=>({...room,observedAt:new Date(Date.now()).toISOString(),presenceExpiresAt:new Date(Date.now()+lease).toISOString(),...overrides});
    const refresh=async(list)=>{
      await waitFor(()=>!global.__discoveryProbe.isFetching,'previous discovery request settled before clicking Refresh');
      f.list=list;f.listFails=false;const before=f.listCalls;
      await click('Refresh Lynks');
      await waitFor(()=>f.listCalls>before&&!global.__discoveryProbe.isFetching,'Refresh dispatched and settled');
    };
    f.list=[fresh()];await render('discovery');await act(()=>new Promise(resolve=>setTimeout(resolve,30)));
    assert.match(node.textContent,/Live now.*Private.*Video/);assert.match(node.textContent,/5 \/ 5 in room/);assert.match(node.textContent,/Check room/);
    await act(()=>node.querySelector('[aria-label^="Studio hangout"]').click());assert.match(f.navigations.at(-1),/room-one/,'full rooms still reach authoritative admission');
    await act(()=>app.useMessagesTabStore.setState({search:'no such lynk'}));assert.match(node.textContent,/No Lynks match/);assert.doesNotMatch(node.textContent,/Studio hangout/);
    await act(()=>app.useMessagesTabStore.setState({search:'bea'}));assert.match(node.textContent,/Studio hangout/,'search filters by host immediately');
    await act(()=>app.useMessagesTabStore.setState({search:''}));
    f.listFails=true;await click('Refresh Lynks');await act(()=>new Promise(resolve=>setTimeout(resolve,50)));
    assert.match(node.querySelector('[role="alert"]').textContent,/Showing the last available rooms/);assert.match(node.textContent,/Studio hangout/);
    const retainedLive=global.__discoveryProbe.rooms[0];
    const roomButton=node.querySelector('[aria-label^="Studio hangout"]');
    const retainedClick=roomButton[Object.keys(roomButton).find(key=>key.startsWith('__reactProps'))].onClick;
    assert.equal(app.discoveryRoomState(retainedLive).actionable,true,'failed refresh keeps still-fresh previous proof');
    await refresh([]);assert.match(node.textContent,/Make the first connection/);
    const routesBeforeReplacement=f.navigations.length;await act(()=>retainedClick());
    assert.equal(f.navigations.length,routesBeforeReplacement,'successful empty snapshot revokes retained prior navigation callback');
    assert.equal(app.discoveryRoomState(retainedLive).actionable,false);
    await refresh([fresh()]);const beforeEnded=global.__discoveryProbe.rooms[0];
    await refresh([fresh({status:'ended',availability:'ended',isLive:false})]);
    assert.equal(app.discoveryRoomState(beforeEnded).actionable,false,'new ended snapshot revokes earlier live proof');
    await refresh([]);

    await act(()=>global.__historyFixture.setState({rooms:[{...room,source:'sneaky_lynk',host:{...room.host,id:'someone-else'}}]}));
    assert.doesNotMatch(node.textContent,/Studio hangout/,'other-account persisted rooms are private');
    await refresh([fresh({isLive:false,availability:'inactive',isInvited:true})]);
    assert.match(node.textContent,/Your rooms & invitations/);assert.match(node.textContent,/Waiting for host/);
    assert.equal(node.querySelector('[aria-label^="Studio hangout"]').disabled,true);
    await refresh([fresh({isLive:false,availability:'inactive'})]);assert.doesNotMatch(node.textContent,/Studio hangout/,'inactive public strangers are omitted');
    await refresh([fresh({isLive:false,availability:'inactive',isOwner:true})]);assert.match(node.textContent,/Resume/);
    await refresh([fresh({isLive:false,status:'ended',availability:'ended'})]);assert.match(node.textContent,/Recently ended/);assert.equal(node.querySelector('[aria-label^="Studio hangout"]').disabled,true);
    await act(()=>global.__historyFixture.setState({rooms:[{...room,source:'sneaky_lynk',host:{...room.host,id:'me'},isOwner:true}]}));
    await refresh([]);assert.match(node.textContent,/Studio hangout/);assert.equal(node.querySelector('[aria-label^="Studio hangout"]').disabled,true,'local history never grants Join/Resume');
    await act(()=>global.__historyFixture.setState({rooms:[]}));
    // Drive only the actual timer scheduled by the production hook. No focus,
    // refresh, or extra render is allowed to hide a missing expiry notification.
    const beforeLeaseWall=Date.now,beforeLeasePerformance=global.performance;
    let leaseWall=beforeLeaseWall(),leaseMono=beforeLeasePerformance.now();
    const leaseDriver=f.discoveryClock={now:leaseMono,next:0,timers:new Map()};
    Date.now=()=>leaseWall;Object.defineProperty(global,'performance',{configurable:true,value:new Proxy(beforeLeasePerformance,{get:(target,key)=>key==='now'?()=>leaseMono:typeof target[key]==='function'?target[key].bind(target):target[key]})});
    try {
      await refresh([fresh()]);
      f.deferLists=true;await click('Refresh Lynks');const releasePreviousRefresh=f.finishList;
      assert.equal(button('Refresh Lynks').disabled,true,'simulate a previous refresh still pending under load');
      const callsWhileDisabled=f.listCalls;
      await act(()=>button('Refresh Lynks').click());
      assert.equal(f.listCalls,callsWhileDisabled,'clicking disabled Refresh silently leaves the old long lease in place');
      f.deferLists=false;
      const releasePreviousTimer=setTimeout(()=>releasePreviousRefresh([fresh()]),30);
      try { await refresh([fresh({},200)]); } finally { clearTimeout(releasePreviousTimer); }
      assert.equal(f.listCalls,callsWhileDisabled+1,'refresh helper waits for the pending request before dispatching the short lease');
      const acceptedLease=global.__discoveryProbe.rooms[0];
      assert.equal(Date.parse(acceptedLease.presenceExpiresAt)-Date.parse(acceptedLease.observedAt),200,'the short lease was actually accepted, not a dropped disabled-button click');
      assert.equal(acceptedLease.requestStartedAt,leaseWall);
      assert.match(node.textContent,/Studio hangout/);
      f.listFails=true;await click('Refresh Lynks');
      await waitFor(()=>global.__discoveryProbe.isError&&!global.__discoveryProbe.isFetching,'refresh failed before expiry');
      assert.ok([...leaseDriver.timers.values()].some(timer=>timer.at===acceptedLease.requestStartedMonotonic+200),'production hook schedules the exact lease boundary');
      const advanceLease=async(ms)=>{
        leaseWall+=ms;leaseMono+=ms;leaseDriver.now=leaseMono;
        await act(()=>{for(const [id,timer] of [...leaseDriver.timers]){if(timer.at<=leaseDriver.now){leaseDriver.timers.delete(id);timer.callback();}}});
      };
      await advanceLease(199);assert.match(node.textContent,/Studio hangout/,'fresh proof remains visible immediately before expiry during error');
      await advanceLease(1);
      assert.doesNotMatch(node.textContent,/Studio hangout/,'scheduled expiry removes the card at the lease boundary during refresh error');
      assert.match(node.textContent,/Couldn’t load Lynks/);
    } finally {f.discoveryClock=null;Date.now=beforeLeaseWall;Object.defineProperty(global,'performance',{configurable:true,value:beforeLeasePerformance});}
    // Offset the device clock without changing server deadlines. Transit uses both clocks.
    const originalNow=Date.now, originalPerformance=global.performance;
    let wall=originalNow(),mono=originalPerformance.now();
    Date.now=()=>wall;Object.defineProperty(global,'performance',{configurable:true,value:new Proxy(originalPerformance,{get:(target,key)=>key==='now'?()=>mono:typeof target[key]==='function'?target[key].bind(target):target[key]})});
    const advance=async(wallDelta,monoDelta=wallDelta)=>{wall+=wallDelta;mono+=monoDelta;await act(()=>window.dispatchEvent(new window.Event('focus')));};
    try {
      await refresh([fresh({observedAt:new Date(wall+3600_000).toISOString(),presenceExpiresAt:new Date(wall+3690_000).toISOString(),endsAt:new Date(wall+3700_000).toISOString()})]);
      assert.match(node.textContent,/Live now/,'server/client wall offset does not invalidate fresh proof');
      await advance(-3600_000,90_000);assert.doesNotMatch(node.textContent,/Studio hangout/,'monotonic expiry defeats wall rollback');
      await refresh([fresh({isOwner:true})]);await advance(90_000,0);assert.doesNotMatch(node.textContent,/Check room|Resume/);
      await advance(-90_000,0);assert.doesNotMatch(node.textContent,/Check room|Resume/,'expired live and owner proofs do not resurrect after clock rollback');
      await refresh([fresh({isOwner:true,endsAt:new Date(wall+500).toISOString()})]);await advance(500,0);assert.match(node.textContent,/Recently ended/);
      await advance(-500,0);assert.match(node.textContent,/Recently ended/,'expired deadline remains ended after rollback');
      f.deferLists=true;await click('Refresh Lynks');const slow=f.finishList;const oldServer=wall;
      await advance(90_001);f.deferLists=false;await act(()=>slow([fresh({observedAt:new Date(oldServer).toISOString(),presenceExpiresAt:new Date(oldServer+90_000).toISOString()})]));
      assert.doesNotMatch(node.textContent,/Studio hangout/,'slow response consumes lease from request start');
      await refresh([fresh()]);wall+=90_001;mono+=90_001;await act(()=>document.dispatchEvent(new window.Event('visibilitychange')));
      assert.doesNotMatch(node.textContent,/Studio hangout/,'background return rechecks expired proof');
    } finally {Date.now=originalNow;Object.defineProperty(global,'performance',{configurable:true,value:originalPerformance});}
    await refresh([fresh()]);
    const beforeRemount=global.__discoveryProbe.rooms[0], refetchBeforeRemount=global.__discoveryProbe.refetch;
    const cachedQuery=app.client.getQueryCache().getAll().find(query=>query.queryKey[0]==='sneaky-lynk'&&query.queryKey[1]==='rooms'&&query.state.data?.length);
    const persistedCopy=JSON.parse(JSON.stringify(cachedQuery.state.data));persistedCopy[0].isCurrent=()=>true;
    await act(()=>renderer.unmount());renderer=app.mount(node);
    app.client.setQueryData(cachedQuery.queryKey,persistedCopy);
    f.deferLists=true;await render('discovery');
    assert.doesNotMatch(node.textContent,/Studio hangout/,'remount rejects persisted old cached proofs and stale isCurrent closures');
    assert.equal(app.discoveryRoomState(beforeRemount).actionable,false,'unmount revokes retained card proof');
    let countBeforeOldRefetch=f.listCalls;await act(()=>refetchBeforeRemount());assert.equal(f.listCalls,countBeforeOldRefetch);
    f.deferLists=false;await act(()=>f.finishList([fresh()]));assert.match(node.textContent,/Studio hangout/);
    // Cancelled same-scope responses must not replace the accepted newer observation.
    const displayedBeforeOverlap=global.__discoveryProbe.rooms[0];
    f.deferLists=true;await click('Refresh Lynks');const finishOlderList=f.finishList,olderListGuard=f.listGuard;
    assert.equal(app.discoveryRoomState(displayedBeforeOverlap).actionable,true,'in-flight refresh does not revoke the displayed fresh observation');
    await act(()=>{void global.__discoveryProbe.refetch();});const finishNewerList=f.finishList;
    assert.notEqual(finishNewerList,finishOlderList);assert.equal(olderListGuard(),false,'cancelled request guard revoked before response');
    await act(()=>finishNewerList([fresh({id:'newer-room',title:'Newer conversation'})]));
    const newestObservation=global.__discoveryProbe.rooms[0];assert.equal(app.discoveryRoomState(newestObservation).actionable,true);
    await act(()=>finishOlderList([fresh({id:'older-room',title:'Older conversation'})]));
    assert.match(node.textContent,/Newer conversation/);assert.doesNotMatch(node.textContent,/Older conversation/);
    assert.equal(app.discoveryRoomState(newestObservation).actionable,true,'older cancelled response cannot overwrite accepted newest response');
    assert.equal(app.discoveryRoomState(displayedBeforeOverlap).actionable,false,'successful newer response revokes prior displayed proof');
    f.deferLists=false;await refresh([fresh()]);
    // Session lifecycle B may publish while the profile is still A, and vice versa.
    const accountA=app.useAuthStore.getState().user;
    f.list=[fresh()];await act(()=>app.publishSessionBoundary({ready:true,authId:accountA.authId}));await act(()=>new Promise(resolve=>setTimeout(resolve,30)));
    assert.match(node.textContent,/Studio hangout/);
    const staleRefetch=global.__discoveryProbe.refetch;let calls=f.listCalls;
    await act(()=>app.publishSessionBoundary({ready:true,authId:'auth-b'}));
    assert.doesNotMatch(node.textContent,/Studio hangout/);await act(()=>staleRefetch());assert.equal(f.listCalls,calls,'mismatched lifecycle B/profile A cannot refetch');
    await act(()=>global.__discoveryProbe.refetch());assert.equal(f.listCalls,calls,'disabled current mismatch cannot manually refetch');
    await act(()=>app.useAuthStore.setState({user:{id:'b',authId:'auth-b'}}));await act(()=>new Promise(resolve=>setTimeout(resolve,30)));assert.ok(f.listCalls>calls);
    calls=f.listCalls;await act(()=>app.useAuthStore.setState({user:accountA}));await act(()=>global.__discoveryProbe.refetch());assert.equal(f.listCalls,calls,'profile A/session B mismatch is also disabled');
    await act(()=>app.publishSessionBoundary({ready:true,authId:accountA.authId}));await act(()=>new Promise(resolve=>setTimeout(resolve,30)));
    // Same-account renewal and A-B-A boundaries must drop previous results immediately.
    f.deferLists=true;await click('Refresh Lynks');const oldGuard=f.listGuard,oldResponse=f.finishList;
    await act(()=>app.publishSessionBoundary({ready:false}));assert.equal(oldGuard(),false);assert.doesNotMatch(node.textContent,/Studio hangout/);
    await act(()=>app.publishSessionBoundary({ready:true,authId:accountA.authId}));const replacement=f.finishList;assert.equal(oldGuard(),false);
    await act(()=>oldResponse([fresh()]));assert.doesNotMatch(node.textContent,/Studio hangout/,'old same-account response cannot populate renewed session');
    f.deferLists=false;await act(()=>replacement([fresh()]));assert.match(node.textContent,/Studio hangout/);
    const beforeABA=global.__discoveryProbe.refetch;calls=f.listCalls;
    await act(()=>{app.useAuthStore.setState({user:{id:'b',authId:'auth-b'}});app.useAuthStore.setState({user:accountA});});
    await act(()=>beforeABA());assert.equal(f.listCalls,calls+1,'A-B-A triggers one new query, old refetch adds no dispatch');
    const signedInRefetch=global.__discoveryProbe.refetch;calls=f.listCalls;
    await act(()=>app.useAuthStore.setState({isAuthenticated:false,user:null}));await act(()=>signedInRefetch());await act(()=>global.__discoveryProbe.refetch());
    assert.equal(f.listCalls,calls,'signed-out refetch never dispatches');assert.doesNotMatch(node.textContent,/Studio hangout/);
    // Numeric-only persisted profiles resolve safely instead of pretending the room list is empty.
    f.listFails=false;f.list=[fresh()];
    await act(()=>{app.publishSessionBoundary({ready:true,authId:'auth-legacy'});app.useAuthStore.setState({isAuthenticated:true,user:{id:'17',email:'legacy@example.test'}});});
    calls=f.listCalls;assert.match(node.textContent,/Finding Lynks/);assert.doesNotMatch(node.textContent,/Make the first connection/);
    await act(()=>f.finishIdentity({id:17,authId:'auth-legacy'}));await act(()=>new Promise(resolve=>setTimeout(resolve,30)));
    assert.equal(app.useAuthStore.getState().user.authId,'auth-legacy');assert.ok(f.listCalls>calls);assert.match(node.textContent,/Studio hangout/);
    await act(()=>{app.publishSessionBoundary({ready:true});app.useAuthStore.setState({user:{id:'18',email:'older@example.test'}});});
    const finishOldIdentity=f.finishIdentity;
    await act(()=>app.useAuthStore.setState({user:{id:'19',email:'newer@example.test'}}));const finishNewIdentity=f.finishIdentity;
    calls=f.listCalls;await act(()=>finishOldIdentity({id:18,authId:'auth-old'}));
    assert.equal(app.useAuthStore.getState().user.id,'19');assert.equal(app.useAuthStore.getState().user.authId,undefined);assert.equal(f.listCalls,calls,'late identity repair cannot dispatch or modify another profile');
    await act(()=>finishNewIdentity({id:19,authId:'auth-new'}));await act(()=>new Promise(resolve=>setTimeout(resolve,30)));assert.equal(app.useAuthStore.getState().user.authId,'auth-new');
    await act(()=>{app.publishSessionBoundary({ready:true,authId:'auth-unrelated'});app.useAuthStore.setState({user:{id:'20',email:'mismatch@example.test'}});});
    calls=f.listCalls;await act(()=>f.finishIdentity({id:20,authId:'auth-mismatch'}));await act(()=>new Promise(resolve=>setTimeout(resolve,10)));await act(()=>f.finishIdentity({id:20,authId:'auth-mismatch'}));
    assert.equal(app.useAuthStore.getState().user.authId,undefined);assert.equal(f.listCalls,calls,'known mismatched session never lends identity to numeric profile');assert.match(node.textContent,/Couldn’t load Lynks/);
    await click('Try again');await act(()=>f.finishIdentity(null));await act(()=>new Promise(resolve=>setTimeout(resolve,10)));await act(()=>f.finishIdentity(null));assert.match(node.textContent,/Couldn’t load Lynks/,'unresolved identity is a recoverable error, not an empty list');
    f.listFails=true;await act(()=>app.publishSessionBoundary({ready:true,authId:'new-account'}));await act(()=>app.useAuthStore.setState({isAuthenticated:true,user:{id:'new-account'}}));await act(()=>new Promise(resolve=>setTimeout(resolve,50)));
    assert.doesNotMatch(node.textContent,/Studio hangout/);assert.match(node.textContent,/Couldn’t load Lynks/);assert.doesNotMatch(node.textContent,/Make the first connection/,'error is not an empty list');
    console.log('PASS creation/discovery DOM: duplicate submit, private invite payload, failure/retry, draft preservation, confirmed ID navigation, A-B-A ownership, verification intent invalidation and latest-intent-only consumption, synchronous Back revocation, late response/timer suppression, membership retry, cancellable search, real empty/error states, account-scoped discovery, strict session/profile matching, same-account renewal, signed-out dispatch suppression, runtime-only cache proofs, response supersession, exact lease expiry during errors, slow response, server offset, monotonic expiry, clock rollback latches, background return, instant search, full-room admission, ended state. Synthetic services; no live invites or room creation.');
  } finally {await act(()=>renderer.unmount());app.client.clear();await window.happyDOM.close();delete global.__lynkCreateFixture;}
})().catch(error=>{console.error(error);process.exitCode=1;});
