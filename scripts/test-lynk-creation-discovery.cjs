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
      import {useLynkDiscovery} from './packages/app/features/sneaky-lynk/hooks/useLynkDiscovery';
      import {discoveryRoomState} from './packages/app/features/sneaky-lynk/discovery-room-state';
      import {useLynkInviteSearch} from './packages/app/features/sneaky-lynk/hooks/useLynkInviteSearch';
      import {useAuthStore} from '@dvnt/app/lib/stores/auth-store';
      import {useUIStore} from '@dvnt/app/lib/stores/ui-store';
      import {useRouter} from 'solito/navigation';
      import {Radio,Plus,RefreshCw,Lock,Globe,Video,Headphones,ArrowUpRight} from 'lucide-react';
      ${discoverySource}
      const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0,retryDelay:1}}});
      export {act,useCreateLynkStore,useAuthStore,client};
      function SearchProbe({query,enabled=true}){const search=useLynkInviteSearch({query,enabled,selfIds:['me'],invitees:[]});globalThis.__searchProbe=search;return <div>{search.isSearching?'searching':search.isError?'error':search.isEmpty?'empty':search.results.map(u=>u.username).join(',')}</div>}
      export function mount(node){const root=createRoot(node);return {render:(screen,props={})=>root.render(<QueryClientProvider client={client}>{screen==='create'?<SneakyLynkCreateScreen/>:screen==='discovery'?<SneakyLynkTab/>:<SearchProbe {...props}/>}</QueryClientProvider>),unmount:()=>root.unmount()};}
    ` },
    bundle: true, write: false, platform: browserMode ? 'browser' : 'node', format: browserMode ? 'iife' : 'cjs', globalName: browserMode ? 'fixtureApp' : undefined, jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
    plugins: [{ name: 'service-boundaries', setup(build) {
      build.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|zustand(?:\/.*)?|@tanstack\/react-query)$/ }, ({path:name}) => ({path:resolve(name),external:!browserMode && name !== '@tanstack/react-query'}));
      build.onResolve({ filter: /^(solito\/navigation|lucide-react|@dvnt\/ui|@dvnt\/app\/lib\/stores\/(?:ui-store|auth-store)|@dvnt\/app\/lib\/subscription\/use-entitlements|@dvnt\/app\/lib\/hooks\/use-verified-gate|@dvnt\/app\/lib\/api\/users)$/ }, ({path:name}) => browserMode && name==='lucide-react' ? ({path:resolve(name)}) : ({path:name,namespace:'fixture'}));
      build.onResolve({ filter: /(?:api\/supabase|stores\/lynk-history-store)$/ }, ({path:name}) => ({path:name,namespace:'fixture'}));
      build.onResolve({ filter: /^@dvnt\/app\// }, ({path:name}) => ({path:path.join(ROOT,'packages/app',name.slice('@dvnt/app/'.length)+'.ts')}));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path:name}) => {
        let contents;
        if (name==='lucide-react') contents=`export const ArrowLeft=()=>null,Radio=()=>null,Video=()=>null,Globe=()=>null,Lock=()=>null,UserPlus=()=>null,X=()=>null,Plus=()=>null,Smartphone=()=>null,Loader2=()=>null,AlertCircle=()=>null,RefreshCw=()=>null,Headphones=()=>null,ArrowUpRight=()=>null;`;
        else if (name==='@dvnt/ui') contents=`import React from 'react';export const FormField=({children,label,htmlFor})=><div><label htmlFor={htmlFor}>{label}</label>{children}</div>;`;
        else if (name==='solito/navigation') contents=`export const useRouter=()=>({push:target=>globalThis.__lynkCreateFixture.navigations.push(target),back:()=>{}});`;
        else if (name.endsWith('auth-store')) contents=`import {create} from 'zustand';export const useAuthStore=create(()=>({user:{id:'me',authId:'auth-me',username:'owner'}}));`;
        else if (name.endsWith('ui-store')) contents=`export const useUIStore=selector=>selector({showToast:(...args)=>globalThis.__lynkCreateFixture.toasts.push(args)});`;
        else if (name.endsWith('use-entitlements')) contents=`export const useEntitlements=()=>({entitlements:{planKey:'free',maxParticipants:5,sessionMinutes:15,monthlyHostSessions:3},isLoading:false,isError:globalThis.__lynkCreateFixture.membershipError,refetch:()=>globalThis.__lynkCreateFixture.membershipRetries++});`;
        else if (name.endsWith('use-verified-gate')) contents=`export const useVerifiedGate=()=>((_,fn)=>{const f=globalThis.__lynkCreateFixture;if(f.pauseVerification)f.acceptVerification=fn;else fn();});`;
        else if (name.endsWith('lynk-history-store')) contents=`import {create} from 'zustand';export const useLynkHistoryStore=create(()=>({rooms:[],addRoom:room=>globalThis.__lynkCreateFixture.history.push(room)}));globalThis.__historyFixture=useLynkHistoryStore;`;
        else if (name.endsWith('api/users')) contents=`export const usersApi={searchUsers:(term)=>{const f=globalThis.__lynkCreateFixture;f.searches.push(term);if(f.searchFails)return Promise.reject(new Error('network'));return new Promise(resolve=>{f.finishSearch=resolve;});}};`;
        else if (name.endsWith('api/supabase')) contents=`export const sneakyLynkApi={createRoom:(params,options)=>{const f=globalThis.__lynkCreateFixture;f.creates.push(params);f.createGuard=options.isCurrent;return new Promise(resolve=>{f.finishCreate=resolve;});},getLiveRooms:()=>{const f=globalThis.__lynkCreateFixture;return f.listFails?Promise.reject(new Error('offline')):Promise.resolve(f.list);}};`;
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
        await page.evaluate(()=>{const f=globalThis.__lynkCreateFixture;f.list=Array.from({length:4},(_,i)=>({id:'room-'+i,title:i===0?'AVeryLongUnbrokenRoomTitleThatMustWrapAndNeverPushTheCardsPastThePhoneEdge':'After hours, good company',topic:'Music, ideas and whatever comes next. An open conversation to end the evening.',isLive:i!==1,status:i===3?'ended':'open',presenceKnown:i!==1,isPublic:i%2===0,hasVideo:i%2!==0,listeners:12,maxParticipants:30,createdAt:'2026-11-07T00:00:00Z',host:{id:'host',displayName:'Avery and an unusually long host name',username:'avery',avatar:''},speakers:[],description:''}));renderer.render('discovery');});
        await page.getByRole('region',{name:'Open rooms'}).waitFor();await page.waitForTimeout(50);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'discovery no horizontal overflow at '+width);
        const cards=await page.locator('button[aria-label$="people."],button[aria-label$="entry."]').evaluateAll(nodes=>nodes.map(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right})));
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

    const room={id:'room-one',title:'Studio hangout',topic:'Music after dark',isLive:true,status:'open',hasVideo:true,isPublic:false,listeners:5,maxParticipants:5,createdAt:'2026-11-07T00:00:00Z',host:{id:'other',displayName:'Bea',username:'bea',avatar:''},speakers:[],description:''};
    f.list=[room];await render('discovery');await act(()=>new Promise(resolve=>setTimeout(resolve,30)));
    assert.match(node.textContent,/Live now.*Private.*Video/);assert.match(node.textContent,/5 \/ 5 in room/);assert.match(node.textContent,/Check room/);
    await act(()=>node.querySelector('[aria-label^="Studio hangout"]').click());assert.match(f.navigations.at(-1),/room-one/,'snapshot-full rooms still reach authoritative admission');
    f.listFails=true;await click('Refresh Lynks');await act(()=>new Promise(resolve=>setTimeout(resolve,50)));
    assert.match(node.querySelector('[role="alert"]').textContent,/Showing the last available rooms/);assert.match(node.textContent,/Studio hangout/);
    f.listFails=false;f.list=[];await click('Try again');await act(()=>new Promise(resolve=>setTimeout(resolve,30)));assert.match(node.textContent,/Make the first connection/);
    await act(()=>global.__historyFixture.setState({rooms:[{...room,source:'sneaky_lynk',host:{...room.host,id:'someone-else'}}]}));
    await render('discovery');assert.doesNotMatch(node.textContent,/Studio hangout/,'persisted rooms from another account stay private');
    f.list=[{...room,isLive:false,status:'open',presenceKnown:false,listeners:50,maxParticipants:5}];
    await click('Refresh Lynks');await act(()=>new Promise(resolve=>setTimeout(resolve,30)));
    assert.match(node.textContent,/Open room/);assert.match(node.textContent,/Availability checked on entry/);
    assert.doesNotMatch(node.textContent,/50 \/ 5|Ended/);assert.equal(node.querySelector('[aria-label^="Studio hangout"]').disabled,false,'hidden fallback host never closes a live room');
    f.list=[{...room,isLive:false,status:'ended'}];await click('Refresh Lynks');await act(()=>new Promise(resolve=>setTimeout(resolve,30)));
    assert.match(node.textContent,/Recently ended/);assert.equal(node.querySelector('[aria-label^="Studio hangout"]').disabled,true);
    f.listFails=true;await act(()=>app.useAuthStore.setState({user:{id:'new-account'}}));await act(()=>new Promise(resolve=>setTimeout(resolve,50)));
    assert.doesNotMatch(node.textContent,/Studio hangout/,'account change never reuses private query data');assert.match(node.textContent,/Couldn’t load Lynks/);assert.doesNotMatch(node.textContent,/Make the first connection/,'error is not an empty room list');
    console.log('PASS creation/discovery DOM: duplicate submit, private invite payload, failure/retry, draft preservation, confirmed ID navigation, A-B-A ownership, verification intent invalidation and latest-intent-only consumption, synchronous Back revocation, late response/timer suppression, membership retry, cancellable search, real empty/error states, account-scoped discovery, stale data, full-room admission, ended state. Synthetic services; no live invites or room creation.');
  } finally {await act(()=>renderer.unmount());app.client.clear();await window.happyDOM.close();delete global.__lynkCreateFixture;}
})().catch(error=>{console.error(error);process.exitCode=1;});
