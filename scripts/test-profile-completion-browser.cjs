// Actual ProfileCompletionPopup + Dialog + ReactDOM. Only auth/router/network
// boundaries are fixtures; no live accounts, uploads or backend writes occur.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('@playwright/test')); }
const ROOT = path.resolve(__dirname, '..');
const complete = { step: 'complete', required: false, hasPhoto: true, hasPost: true, emailVerified: true, adultVerified: true };
const photo = { ...complete, step: 'photo', required: true, hasPhoto: false };
const firstPost = { ...complete, step: 'first_post', required: true, hasPost: false };
const boundaries = {
  'profile-fixture': `import {useSyncExternalStore} from 'react';
    const listeners=new Set(),authListeners=new Set();let revision=0;
    export const state={path:'/feed',user:{authId:'a',id:'1'},verification:false,empty:false};
    export const authSnapshot=()=>({user:state.user,_hasHydrated:true,isAuthenticated:!!state.user});
    export const subscribeAuth=fn=>{authListeners.add(fn);return()=>authListeners.delete(fn)};
    export const useValue=select=>{useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision);return select(state)};
    const update=patch=>{const previous=authSnapshot();Object.assign(state,patch);revision++;for(const fn of authListeners)fn(authSnapshot(),previous);for(const fn of listeners)fn()};
    window.fixture={requests:[],navigations:[],backgroundClicks:0,update};
    export const router={push:path=>{window.fixture.navigations.push(path);update({path})}};`,
  'next/navigation': `import {useValue,router} from 'profile-fixture';export const usePathname=()=>useValue(s=>s.path);export const useRouter=()=>router;`,
  '@dvnt/app/lib/stores/auth-store': `import {useValue,authSnapshot,subscribeAuth} from 'profile-fixture';export const useAuthStore=select=>useValue(()=>select(authSnapshot()));useAuthStore.subscribe=subscribeAuth;useAuthStore.getState=authSnapshot;`,
  '@dvnt/app/lib/auth/verified-only-prompt': `import {useValue} from 'profile-fixture';export const useVerifiedOnlyPromptStore=select=>useValue(s=>select({open:s.verification}));`,
  '@dvnt/app/lib/profile/new-member-progress': `export const fetchNewMemberProgress=()=>new Promise((resolve,reject)=>window.fixture.requests.push({resolve,reject}));`,
  'lucide-react': ['ArrowUpRight','Camera','CheckCircle2','ImagePlus','PenLine','Sparkles','X'].map(name=>`export const ${name}=()=>null;`).join('\n'),
};
(async () => {
  const build = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {useValue} from 'profile-fixture';import {Dialog} from '@dvnt/ui';
      import {ProfileCompletionPopup} from './apps/web/src/components/profile-completion-popup';
      import {invalidateProfileCompletion} from '@dvnt/app/lib/profile/profile-completion-invalidation';
      window.fixture.invalidateProfileCompletion=invalidateProfileCompletion;
      function Fixture(){const empty=useValue(s=>s.empty);return <><button id="background" onClick={()=>window.fixture.backgroundClicks++}>Background action</button>{empty?<Dialog open hideClose dismissible={false} onClose={()=>{}} labelledBy="empty-title"><h2 id="empty-title">Waiting without controls</h2></Dialog>:<ProfileCompletionPopup/>}</>}
      createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: ROOT, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    // Exercise the web DOM components with React's JSX runtime; the app's
    // NativeWind tsconfig is consumed by Next's own compiler, not this fixture.
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' } },
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'explicit-profile-fixtures', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (Object.hasOwn(boundaries,args.path)) return {path:args.path,namespace:'fixture'};
        if (args.path==='@dvnt/ui') return {path:path.join(ROOT,'packages/ui/src/form/Dialog.web.tsx')};
        if (args.path.startsWith('@dvnt/app/lib/profile/')) return {path:path.join(ROOT,'packages/app/lib/profile',args.path.split('/').at(-1)+'.ts')};
      });
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:boundaries[args.path],loader:'tsx',resolveDir:ROOT}));
    }}],
  });
  const server=http.createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(build.outputFiles[0].contents)}
    res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><style>body{font:16px system-ui;background:#080910;color:white}[role=dialog]{position:fixed;inset:0;padding:40px;background:#101321;z-index:100}button{padding:12px;margin:8px}</style><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const waitRequests=async count=>page.waitForFunction(n=>window.fixture.requests.length>=n,count);
    const update=async patch=>page.evaluate(p=>window.fixture.update(p),patch);
    const resolve=async(index,progress)=>page.evaluate(({index,progress})=>window.fixture.requests[index].resolve(progress),{index,progress});
    const reject=async index=>page.evaluate(i=>window.fixture.requests[i].reject(new Error('offline')),index);
    const focusInside=async()=>{await page.waitForFunction(()=>!!document.activeElement?.closest('[role=dialog]'));};
    const assertNoDialog=async()=>page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
    const dismissFails=async()=>{
      await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);
      await page.getByRole('dialog').click({position:{x:5,y:5}});assert.equal(await page.getByRole('dialog').count(),1);
      assert.equal(await page.getByRole('button',{name:'Close',exact:true}).count(),0);
      // Clicking a nonfocusable backdrop may blur the control. The next Tab
      // must return to the first dialog control rather than the covered app.
      await page.keyboard.press('Tab');await focusInside();
      // Programmatic/outside focus is also recaptured in either direction.
      await page.locator('#background').focus();
      await page.keyboard.press('Shift+Tab');await focusInside();
      await page.locator('#background').focus();
      await page.keyboard.press('Tab');await focusInside();
    };
    // Pending reads trap focus, including Enter on the previously focused app.
    await waitRequests(1);await focusInside();await dismissFails();
    for(const key of ['Tab','Shift+Tab','Tab','Shift+Tab']){await page.keyboard.press(key);await focusInside()}
    // Enter belongs on the status heading for this safety assertion. Enter on
    // the deliberately reachable My tickets button should navigate to tickets.
    await page.locator('#profile-completion-status-title').focus();
    await page.keyboard.press('Enter');await focusInside();
    assert.equal(await page.evaluate(()=>window.fixture.backgroundClicks),0);
    await reject(0);await page.getByRole('button',{name:'Retry connection'}).waitFor();await focusInside();
    assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Retry connection');
    await page.getByRole('button',{name:'Retry connection'}).click();await waitRequests(2);await focusInside();
    await resolve(1,complete);await assertNoDialog();

    // A complete -> B incomplete, with A's newer navigation read arriving late.
    await update({path:'/notifications'});await waitRequests(3);await assertNoDialog();
    await update({user:{authId:'b',id:'2'}});await waitRequests(4);await focusInside();
    await resolve(2,complete);assert.equal(await page.getByRole('dialog').count(),1);
    await resolve(3,photo);await page.getByRole('button',{name:'Add my profile picture'}).waitFor();await focusInside();await dismissFails();
    assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Add my profile picture');
    await page.getByRole('button',{name:'Add my profile picture'}).click();await waitRequests(5);await assertNoDialog();
    assert.equal(await page.evaluate(()=>window.fixture.navigations.at(-1)),'/feed/onboarding/photo');

    // The former broad create/edit/non-feed bypasses all stay gated.
    for(const route of ['/settings','/events','/game-night','/feed/events/create','/feed/profile/edit','/feed/story/create','/feed/create']){
      const count=await page.evaluate(()=>window.fixture.requests.length);
      await update({path:route});await waitRequests(count+1);await focusInside();
      await resolve(count,photo);await page.getByRole('button',{name:'Add my profile picture'}).waitFor();await focusInside();
    }
    // First-post transition focuses the correct action and only then opens composer.
    let count=await page.evaluate(()=>window.fixture.requests.length);
    await update({path:'/feed'});await waitRequests(count+1);await resolve(count,firstPost);
    await page.getByRole('button',{name:'Create my first post'}).waitFor();await focusInside();
    assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Create my first post');
    await page.getByRole('button',{name:'Create my first post'}).click();await waitRequests(count+2);await assertNoDialog();
    await resolve(count+1,firstPost);await assertNoDialog();

    // Exact wallet/purchase routes remain open during both pending and failure.
    for(const route of ['/feed/events/my-tickets','/feed/events/42','/events/show','/feed/checkout/review','/feed/ticket/42','/feed/onboarding/photo']){
      count=await page.evaluate(()=>window.fixture.requests.length);
      await update({path:route});await waitRequests(count+1);await assertNoDialog();
      await reject(count);await assertNoDialog();
    }
    // Members can reach tickets through the gate itself, without knowing a URL.
    for(const state of ['pending','error','photo']){
      count=await page.evaluate(()=>window.fixture.requests.length);
      await update({path:'/feed'});await waitRequests(count+1);
      if(state==='error'){
        await reject(count);await page.getByRole('button',{name:'Retry connection'}).waitFor();
      }
      if(state==='photo'){
        await resolve(count,photo);await page.getByRole('button',{name:'Add my profile picture'}).waitFor();
      }
      await page.getByRole('button',{name:'My tickets',exact:true}).click();
      await waitRequests(count+2);await assertNoDialog();
      assert.equal(await page.evaluate(()=>window.fixture.navigations.at(-1)),'/feed/events/my-tickets');
    }
    await update({path:'/auth/verify-email'});await assertNoDialog();
    // Existing verification UI owns pending verification; this gate must yield.
    count=await page.evaluate(()=>window.fixture.requests.length);
    await update({path:'/feed',verification:true});await waitRequests(count+1);await assertNoDialog();
    await update({verification:false});await focusInside();
    await resolve(count,{...photo,step:'pending_verification',adultVerified:false});await assertNoDialog();
    // Completed accounts keep server evidence during repeated ordinary links.
    count=await page.evaluate(()=>window.fixture.requests.length);
    await update({user:{authId:'c',id:'3'},path:'/feed'});await waitRequests(count+1);
    await resolve(count,complete);await assertNoDialog();
    await page.evaluate(()=>{
      window.fixture.dialogAppearances=0;
      new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){
        if(node.nodeType===1&&(node.matches('[role=dialog]')||node.querySelector('[role=dialog]')))window.fixture.dialogAppearances++;
      }}).observe(document.body,{childList:true,subtree:true});
    });
    for(const path of ['/feed/messages','/settings','/feed','/events','/feed/profile','/feed']){
      count=await page.evaluate(()=>window.fixture.requests.length);
      await update({path});await waitRequests(count+1);await assertNoDialog();
      await resolve(count,complete);await assertNoDialog();
    }
    assert.equal(await page.evaluate(()=>window.fixture.dialogAppearances),0);

    // A -> B -> A routes: a late first-A success/error cannot replace the last A.
    count=await page.evaluate(()=>window.fixture.requests.length);
    for(const path of ['/settings','/events','/settings']){await update({path});await waitRequests(++count);await assertNoDialog()}
    await resolve(count-1,photo);await page.getByRole('button',{name:'Add my profile picture'}).waitFor();
    await resolve(count-3,complete);await reject(count-2);
    await page.getByRole('button',{name:'Add my profile picture'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Retry connection'}).count(),0);

    // Saved profile/post mutations invalidate evidence, even with no navigation.
    for(const [user,progress] of [
      [{authId:'c',id:'3',avatar:'saved-photo'},firstPost],
      [{authId:'c',id:'3',avatar:'saved-photo',postsCount:1},complete],
    ]){
      count=await page.evaluate(()=>window.fixture.requests.length);
      await update({user});await waitRequests(count+1);
      await page.getByText('Checking your profile…',{exact:true}).waitFor();
      await resolve(count,progress);
      if(progress.step==='complete')await assertNoDialog();
      else await page.getByRole('button',{name:'Create my first post'}).waitFor();
    }
    // An optimistic mutation may fetch the pre-write state. The successful
    // server write must invalidate it even when avatar/count values are equal.
    count=await page.evaluate(()=>window.fixture.requests.length);
    await update({user:{authId:'c',id:'3',avatar:'saved-photo',postsCount:0}});
    await waitRequests(count+1);await resolve(count,complete);await assertNoDialog();
    await page.evaluate(()=>window.fixture.invalidateProfileCompletion({authId:'c',id:'3'}));
    await waitRequests(count+2);await page.getByText('Checking your profile…',{exact:true}).waitFor();
    await resolve(count+1,firstPost);await page.getByRole('button',{name:'Create my first post'}).waitFor();
    await update({user:{authId:'c',id:'3',avatar:'saved-photo',postsCount:1}});
    await waitRequests(count+3);
    await page.evaluate(()=>window.fixture.invalidateProfileCompletion({authId:'c',id:'3'}));
    await waitRequests(count+4);
    await resolve(count+2,firstPost);await page.getByText('Checking your profile…',{exact:true}).waitFor();
    await resolve(count+3,complete);await assertNoDialog();
    count=await page.evaluate(()=>window.fixture.requests.length);
    await page.evaluate(()=>window.fixture.invalidateProfileCompletion({authId:'old-account'}));
    await assertNoDialog();assert.equal(await page.evaluate(()=>window.fixture.requests.length),count);

    // An ordinary same-value auth-store update does not invalidate completion.
    count=await page.evaluate(()=>window.fixture.requests.length);
    await update({user:{authId:'c',id:'3',avatar:'saved-photo',postsCount:1,name:'Updated name'}});
    await assertNoDialog();assert.equal(await page.evaluate(()=>window.fixture.requests.length),count);

    // React batches both store updates: same member, genuinely new session.
    await page.evaluate(()=>{
      window.fixture.update({user:null});
      window.fixture.update({user:{authId:'c',id:'3',avatar:'saved-photo',postsCount:1}});
    });
    await waitRequests(count+1);await page.getByText('Checking your profile…',{exact:true}).waitFor();
    await resolve(count,complete);await assertNoDialog();
    // Account A -> B -> A in one turn cannot inherit A's prior completion.
    count=await page.evaluate(()=>window.fixture.requests.length);
    await page.evaluate(()=>{
      window.fixture.update({user:{authId:'d',id:'4'}});
      window.fixture.update({user:{authId:'c',id:'3',avatar:'saved-photo',postsCount:1}});
    });
    await waitRequests(count+1);await page.getByText('Checking your profile…',{exact:true}).waitFor();
    await resolve(count,complete);await assertNoDialog();

    // A failed background check stays fail-closed and explicit retry is fresh.
    count=await page.evaluate(()=>window.fixture.requests.length);
    await update({path:'/notifications'});await waitRequests(count+1);await assertNoDialog();
    await reject(count);await page.getByRole('button',{name:'Retry connection'}).waitFor();
    await page.getByRole('button',{name:'Retry connection'}).click();await waitRequests(count+2);
    await page.getByText('Checking your profile…',{exact:true}).waitFor();
    await resolve(count+1,complete);await assertNoDialog();

    // The shared Dialog also has to retain focus while all controls are absent.
    await update({empty:true});await page.getByText('Waiting without controls').waitFor();await focusInside();
    for(const key of ['Tab','Shift+Tab']){
      await page.locator('#background').focus();await page.keyboard.press(key);await focusInside();
    }
    await page.keyboard.press('Enter');await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(),1);
    assert.equal(await page.evaluate(()=>window.fixture.backgroundClicks),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: actual React popup/Dialog pending/error/retry, keyboard focus, Escape/backdrop, account switch/stale results, flicker-free completed navigation, route/account ABA, batched same-member re-login, profile/post mutation refresh, photo/post ordering, ticket exemptions and verification priority.');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
