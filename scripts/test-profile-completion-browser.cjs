// Actual ProfileCompletionPopup + Dialog + ReactDOM. Only auth/router/network
// boundaries are fixtures; no live accounts, uploads or backend writes occur.
// Default is real Chromium. --dom runs the same lifecycle assertions in jsdom;
// its simulated keyboard defaults do not replace the Chromium accessibility run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const complete = { step: 'complete', required: false, hasPhoto: true, hasPost: true, emailVerified: true, adultVerified: true };
const photo = { ...complete, step: 'photo', required: true, hasPhoto: false };
const firstPost = { ...complete, step: 'first_post', required: true, hasPost: false };
const boundaries = {
  'profile-fixture': `import {useSyncExternalStore} from 'react';
    const listeners=new Set(),authListeners=new Set();let revision=0;
    export const state={path:'/feed',user:{authId:'a',id:'1'},verification:false,empty:false,mounted:true,hostKey:0,hydrated:false,authenticated:true};
    export const authSnapshot=()=>({user:state.user,_hasHydrated:state.hydrated,isAuthenticated:state.authenticated&&!!state.user});
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

// Tiny local page adapter: keep the lifecycle scenarios identical in Chromium
// and jsdom rather than maintaining a reduced, unrelated fallback test suite.
function createDOMPage(window) {
  const tick = () => new Promise(resolve => setTimeout(resolve, 10));
  const evaluate = async (fn, arg) => {
    const result = await window.eval(`(${fn.toString()})`)(arg);
    await tick();
    return result;
  };
  const waitForFunction = async (fn, arg) => {
    const deadline = Date.now() + 5000;
    do {
      if (await evaluate(fn, arg)) return;
    } while (Date.now() < deadline);
    throw new Error(`DOM wait timed out: ${fn}`);
  };
  const locator = find => ({
    count: async () => find().length,
    waitFor: async () => {
      const deadline = Date.now() + 5000;
      while (!find().length) {
        if (Date.now() >= deadline) throw new Error(`DOM locator timed out: ${find}`);
        await tick();
      }
      await tick();
    },
    focus: async () => { assert.ok(find()[0], 'focus target exists'); find()[0].focus(); await tick(); },
    click: async () => { assert.ok(find()[0], 'click target exists'); find()[0].click(); await tick(); },
  });
  return {
    evaluate, waitForFunction,
    waitForTimeout: ms => new Promise(resolve => setTimeout(resolve, ms)),
    locator: selector => locator(() => [...window.document.querySelectorAll(selector)]),
    getByRole: (role, options = {}) => locator(() => [...window.document.querySelectorAll(role === 'button' ? 'button,[role="button"]' : `[role="${role}"]`)].filter(node => {
      const label = node.getAttribute('aria-label') || node.textContent.trim();
      return options.name === undefined || (options.exact ? label === options.name : label.includes(options.name));
    })),
    getByText: (text, options = {}) => locator(() => [...window.document.querySelectorAll('body *')].filter(node => {
      const matches = candidate => options.exact ? candidate.textContent.trim() === text : candidate.textContent.includes(text);
      return matches(node) && ![...node.children].some(matches);
    })),
    keyboard: { press: async value => {
      const shiftKey = value.startsWith('Shift+');
      const key = value.replace('Shift+', '');
      const active = window.document.activeElement;
      const event = new window.KeyboardEvent('keydown', {key, shiftKey, bubbles:true, cancelable:true});
      active.dispatchEvent(event);
      // jsdom has no native sequential focus or Enter activation. Model only
      // the unprevented browser default; the real Dialog must trap its edges.
      if (!event.defaultPrevented && key === 'Tab') {
        const items = [...window.document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
        const index = items.indexOf(active);
        items[(index + (shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
      }
      if (!event.defaultPrevented && key === 'Enter' && active.tagName === 'BUTTON') active.click();
      await tick();
    }},
  };
}

async function runScenarios(page, errors) {
  const waitRequests = async count => page.waitForFunction(n => window.fixture.requests.length >= n, count);
  const requestCount = async () => page.evaluate(() => window.fixture.requests.length);
  const settle = async () => page.waitForTimeout(30);
  const update = async patch => { await page.evaluate(p => window.fixture.update(p), patch); await settle(); };
  const resolve = async (index, progress) => { await page.evaluate(({index,progress}) => window.fixture.requests[index].resolve(progress), {index,progress}); await settle(); };
  const reject = async index => { await page.evaluate(i => window.fixture.requests[i].reject(new Error('offline')), index); await settle(); };
  const invalidate = async (member = {authId:'b',id:'2'}) => { await page.evaluate(m => window.fixture.invalidateProfileCompletion(m), member); await settle(); };
  const focusInside = async () => page.waitForFunction(() => !!document.activeElement?.closest('[role=dialog]'));
  const assertNoDialog = async () => page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  const pending = async () => { await assertNoDialog(); };
  const unchangedRequests = async (count, message) => { await settle(); assert.equal(await requestCount(), count, message); };
  const photoButton = () => page.getByRole('button', {name:'Add my profile picture'});
  const postButton = () => page.getByRole('button', {name:'Create my first post'});
  const retryButton = () => page.getByRole('button', {name:'Retry connection'});
  const dismissFails = async () => {
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 1);
    await page.getByRole('dialog').click({position:{x:5,y:5}}); assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(await page.getByRole('button', {name:'Close',exact:true}).count(), 0);
    await page.keyboard.press('Tab'); await focusInside();
    for (const key of ['Shift+Tab','Tab']) {
      await page.locator('#background').focus(); await page.keyboard.press(key); await focusInside();
    }
  };

  // A persisted profile cannot read until the first auth hydration is ready.
  await page.waitForFunction(() => !!window.fixture);
  await assertNoDialog(); await unchangedRequests(0, 'initial unhydrated profile does not read');
  await update({user:{authId:'a',id:'1',avatar:'persisted-photo',postsCount:1}});
  await unchangedRequests(0, 'unhydrated auth snapshot updates do not read');
  await update({hydrated:true});

  // Unknown state checks silently; it does not trap navigation or focus.
  // Server-side participation gates still enforce required verification.
  await waitRequests(1); await pending();
  await page.locator('#background').focus();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await reject(0); await retryButton().waitFor(); await focusInside(); await dismissFails();
  // Dismissal checks move focus, so re-mount the error host to verify autofocus.
  await update({hostKey:1}); await retryButton().waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Retry connection');
  await unchangedRequests(1, 'error host remount does not silently retry');
  await retryButton().click(); await waitRequests(2); await pending();
  await resolve(1, complete); await assertNoDialog();

  // Completed evidence survives route churn, host remount, and all auth-store
  // avatar/count snapshots, including optimistic, absent, and same-value data.
  await page.evaluate(() => {
    window.fixture.dialogAppearances = 0;
    new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1 && (node.matches('[role=dialog]') || node.querySelector('[role=dialog]'))) window.fixture.dialogAppearances++;
    }}).observe(document.body, {childList:true,subtree:true});
  });
  let count = await requestCount();
  for (const path of ['/feed/messages','/settings','/feed','/events','/feed/profile','/auth/verify-email','/feed']) {
    await update({path}); await assertNoDialog(); await unchangedRequests(count, `navigation to ${path} does not read`);
  }
  for (const user of [
    {authId:'a',id:'1',avatar:'optimistic-photo',postsCount:1},
    {authId:'a',id:'1',avatar:'optimistic-photo',postsCount:1,name:'Updated name'},
    {authId:'a',id:'1',avatar:null,postsCount:0},
    {authId:'a',id:'1'},
  ]) {
    await update({user}); await assertNoDialog(); await unchangedRequests(count, 'auth snapshot cannot invalidate confirmed completion');
  }
  await update({hydrated:false}); await assertNoDialog();
  await update({user:{authId:'a',id:'1',avatar:'rehydrated-photo',postsCount:0}});
  await update({hydrated:true}); await assertNoDialog();
  await unchangedRequests(count, 'same-session hydration churn preserves confirmed evidence');
  await update({hostKey:2}); await assertNoDialog();
  await update({mounted:false}); await assertNoDialog();
  await update({mounted:true}); await assertNoDialog();
  await unchangedRequests(count, 'same-session host remount keeps server evidence');
  assert.equal(await page.evaluate(() => window.fixture.dialogAppearances), 0, 'completed navigation and remount never flash the gate');

  // A -> B: A's unresolved explicit refresh cannot authenticate B's progress.
  await invalidate({authId:'a',id:'1'}); await waitRequests(count + 1); await pending();
  await update({user:{authId:'b',id:'2'}}); await waitRequests(count + 2); await pending();
  await resolve(count, complete); await pending();
  await resolve(count + 1, {...photo,hasPost:false}); await photoButton().waitFor(); await focusInside();
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Add my profile picture');
  assert.equal(await postButton().count(), 0, 'photo precedes first post when both are missing');
  await dismissFails();
  count = await requestCount();
  await photoButton().click(); await assertNoDialog();
  assert.equal(await page.evaluate(() => window.fixture.navigations.at(-1)), '/feed/onboarding/photo');
  await unchangedRequests(count, 'photo action only navigates');

  // Former broad create/edit/non-feed bypasses remain mandatory; no route read.
  for (const route of ['/settings','/events','/game-night','/feed/events/create','/feed/profile/edit','/feed/story/create','/feed/create']) {
    await update({path:route}); await photoButton().waitFor(); await focusInside();
    await unchangedRequests(count, `photo remains required on ${route}`);
  }
  // A local photo/count snapshot neither grants access nor starts a read.
  await update({user:{authId:'b',id:'2',avatar:'optimistic-photo',postsCount:1}});
  await photoButton().waitFor(); await unchangedRequests(count, 'optimistic completion is not authoritative');
  await update({path:'/feed'});
  await invalidate(); await waitRequests(count + 1); await pending();
  await resolve(count, firstPost); await postButton().waitFor(); await focusInside();
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Create my first post');
  count = await requestCount();
  await postButton().click(); await assertNoDialog();
  assert.equal(await page.evaluate(() => window.fixture.navigations.at(-1)), '/feed/create');
  await unchangedRequests(count, 'first-post composer navigation reuses authoritative photo completion');
  await update({path:'/settings'}); await postButton().waitFor(); await dismissFails();
  await unchangedRequests(count, 'first post is still mandatory outside its composer');

  // Exact purchase/ticket/completion routes stay open during pending and error.
  for (const route of ['/feed/events/my-tickets','/feed/events/42','/events/show','/feed/checkout/review','/feed/ticket/42','/feed/onboarding/photo']) {
    await update({path:route}); await assertNoDialog();
    count = await requestCount(); await invalidate(); await waitRequests(count + 1); await assertNoDialog();
    await reject(count); await assertNoDialog();
    await update({path:'/feed'}); await retryButton().waitFor(); await focusInside();
    await unchangedRequests(count + 1, 'leaving an exempt route reuses the failure and stays fail-closed');
  }
  // Every gate state exposes a usable path to tickets with no extra request.
  for (const state of ['error','photo','first_post']) {
    await update({path:'/feed'}); count = await requestCount();
    await invalidate(); await waitRequests(count + 1);
    if (state === 'error') { await reject(count); await retryButton().waitFor(); }
    if (state === 'photo') { await resolve(count, photo); await photoButton().waitFor(); }
    if (state === 'first_post') { await resolve(count, firstPost); await postButton().waitFor(); }
    await page.getByRole('button', {name:'My tickets',exact:true}).click(); await assertNoDialog();
    assert.equal(await page.evaluate(() => window.fixture.navigations.at(-1)), '/feed/events/my-tickets');
    await unchangedRequests(count + 1, 'ticket action does not reread or cancel progress');
  }

  // Existing verification UI has priority, including a pending server read.
  count = await requestCount(); await update({path:'/auth/verify-email'}); await assertNoDialog();
  await update({path:'/feed',verification:true}); await assertNoDialog();
  await unchangedRequests(count, 'verification and auth navigation preserve evidence');
  await invalidate(); await waitRequests(count + 1); await assertNoDialog();
  await update({verification:false}); await pending();
  await resolve(count, {...photo,step:'pending_verification',adultVerified:false}); await assertNoDialog();
  await update({path:'/settings'}); await waitRequests(count + 2); await assertNoDialog();
  await resolve(count + 1, {...photo,step:'pending_verification',adultVerified:false}); await assertNoDialog();
  await update({verification:true}); await assertNoDialog();
  await unchangedRequests(count + 2, 'opening verification does not compete with its own UI');
  await update({verification:false}); await waitRequests(count + 3); await assertNoDialog();
  await resolve(count + 2, photo); await photoButton().waitFor(); await focusInside();

  // Multiple explicit invalidations have generations: latest alone can win.
  await update({path:'/feed'}); count = await requestCount();
  await invalidate(); await waitRequests(count + 1); await pending();
  await invalidate(); await waitRequests(count + 2); await pending();
  await resolve(count, complete); await pending();
  await resolve(count + 1, firstPost); await postButton().waitFor();
  count = await requestCount();
  await invalidate(); await waitRequests(count + 1); await pending();
  await invalidate(); await waitRequests(count + 2); await pending();
  await resolve(count + 1, complete); await assertNoDialog();
  await reject(count); await assertNoDialog();
  await invalidate({authId:'old-account'}); await assertNoDialog();
  await unchangedRequests(count + 2, 'another member mutation cannot invalidate the current member');
  // Invalidation remains fresh when auth snapshots are exactly the same.
  count = await requestCount();
  await update({user:{authId:'b',id:'2',avatar:'optimistic-photo',postsCount:1}});
  await unchangedRequests(count, 'same-value auth snapshot keeps confirmed completion');
  await invalidate(); await waitRequests(count + 1); await pending();
  await resolve(count, firstPost); await postButton().waitFor();
  await invalidate(); await waitRequests(count + 2); await pending();
  await resolve(count + 1, complete); await assertNoDialog();

  // Route churn and host remount while pending reuse the one in-flight read.
  count = await requestCount(); await invalidate(); await waitRequests(count + 1); await pending();
  for (const path of ['/settings','/events','/settings','/feed']) { await update({path}); await pending(); }
  await update({mounted:false}); await assertNoDialog();
  await update({mounted:true,hostKey:3}); await pending();
  await unchangedRequests(count + 1, 'pending request survives route ABA and host remount');
  await resolve(count, complete); await assertNoDialog();

  // Logout/relogin and account ABA are observed even when React batches them.
  for (const middle of [null,{authId:'c',id:'3'}]) {
    count = await requestCount();
    await page.evaluate(middle => {
      window.fixture.update({user:middle});
      window.fixture.update({user:{authId:'b',id:'2',avatar:'optimistic-photo',postsCount:1}});
    }, middle);
    await waitRequests(count + 1); await pending();
    const latest = (await requestCount()) - 1;
    for (let index = count; index < latest; index++) { await resolve(index, complete); await pending(); }
    await resolve(latest, complete); await assertNoDialog();
  }
  // Same guarantees apply while no popup host is mounted at all.
  for (const middle of [null,{authId:'c',id:'3'}]) {
    await update({mounted:false}); count = await requestCount();
    await page.evaluate(middle => {
      window.fixture.update({user:middle});
      window.fixture.update({user:{authId:'b',id:'2'}});
    }, middle);
    await update({mounted:true}); await waitRequests(count + 1); await pending();
    const latest = (await requestCount()) - 1;
    for (let index = count; index < latest; index++) { await resolve(index, complete); await pending(); }
    await resolve(latest, complete); await assertNoDialog();
  }
  // Logout during an unmounted pending read must reject its later success.
  count = await requestCount(); await invalidate(); await waitRequests(count + 1); await pending();
  await update({mounted:false}); await update({user:null}); await resolve(count, complete);
  await update({user:{authId:'b',id:'2'}}); await update({mounted:true});
  await waitRequests(count + 2); await pending();
  await resolve((await requestCount()) - 1, firstPost); await postButton().waitFor();
  // A confirmed write while the host is absent invalidates its retained result.
  await update({mounted:false}); count = await requestCount(); await invalidate();
  await update({mounted:true}); await waitRequests(count + 1); await pending();
  await resolve((await requestCount()) - 1, complete); await assertNoDialog();

  // Real authentication boundaries can happen without a null user snapshot.
  // While the token session is not ready, neither stale evidence nor ordinary
  // profile updates may initiate a read against the outgoing credentials.
  for (const unmounted of [false,true]) {
    count = await requestCount(); await invalidate(); await waitRequests(count + 1); await pending();
    if (unmounted) await update({mounted:false});
    await page.evaluate(() => window.fixture.publishSessionBoundary({ready:false}));
    await update({user:{authId:'b',id:'2',avatar:'same-session-shape',postsCount:1}});
    await unchangedRequests(count + 1, 'an unready token session cannot fetch');
    await resolve(count, complete);
    if (!unmounted) await pending();
    await page.evaluate(() => window.fixture.publishSessionBoundary({ready:true,authId:'b'}));
    await waitRequests(count + 2);
    if (unmounted) await update({mounted:true});
    await pending();
    await resolve((await requestCount()) - 1, complete); await assertNoDialog();
  }
  // New session credentials must match the auth profile before a read can run.
  count = await requestCount();
  await page.evaluate(() => window.fixture.publishSessionBoundary({ready:true,authId:'c'}));
  await pending(); await unchangedRequests(count, 'new account credentials cannot be used for the previous profile');
  await update({user:{authId:'c',id:'3'}}); await waitRequests(count + 1); await pending();
  await resolve(count, photo); await photoButton().waitFor();
  await update({user:{authId:'b',id:'2'}}); await pending();
  await unchangedRequests(count + 1, 'mismatching auth snapshot cannot fetch or reuse evidence');
  await page.evaluate(() => window.fixture.publishSessionBoundary({ready:true,authId:'b'}));
  await waitRequests(count + 2); await pending();
  await resolve(count + 1, complete); await assertNoDialog();

  // Explicit refresh failure blocks formerly-complete evidence; retry is fresh.
  count = await requestCount(); await invalidate(); await waitRequests(count + 1); await pending();
  await reject(count); await retryButton().waitFor(); await dismissFails();
  await update({path:'/notifications'}); await retryButton().waitFor();
  await unchangedRequests(count + 1, 'ordinary navigation cannot silently retry failure');
  await retryButton().click(); await waitRequests(count + 2); await pending();
  await resolve(count + 1, complete); await assertNoDialog();
  await update({user:null}); await assertNoDialog();
  // Persisted user snapshots are not a usable session until hydration finishes.
  count = await requestCount();
  await update({user:{authId:'b',id:'2'},hydrated:false}); await assertNoDialog();
  await unchangedRequests(count, 'an unhydrated persisted user cannot initiate a read');
  await update({hydrated:true}); await waitRequests(count + 1); await pending();
  await resolve(count, complete); await assertNoDialog();
  // Authentication may be cleared before its user snapshot is removed.
  count = await requestCount(); await update({authenticated:false}); await assertNoDialog();
  await unchangedRequests(count, 'signed-out user snapshots cannot fetch');
  await update({authenticated:true}); await waitRequests(count + 1); await pending();
  await resolve(count, complete); await assertNoDialog();
  await update({user:null}); await assertNoDialog();

  // Throttled focus/visibility revalidation detects changes elsewhere without
  // turning ordinary navigation into a refresh or flashing a completed gate.
  await update({user:{authId:'b',id:'2'}}); count = await requestCount();
  await resolve(count - 1, complete); await assertNoDialog();
  await page.evaluate(() => {
    window.fixture.realNow = Date.now;
    window.fixture.now = Date.now() + 61_000;
    Date.now = () => window.fixture.now;
    window.fixture.hidden = false;
    Object.defineProperty(document, 'visibilityState', {configurable:true,get:() => window.fixture.hidden ? 'hidden' : 'visible'});
  });
  const backgroundRefresh = async () => {
    await page.evaluate(() => { window.fixture.now += 61_000; window.dispatchEvent(new Event('focus')); });
    await settle();
  };
  await backgroundRefresh(); await waitRequests(count + 1); await assertNoDialog();
  await update({path:'/settings',hostKey:4}); await assertNoDialog();
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await unchangedRequests(count + 1, 'focus, visibility and remount share one in-flight revalidation');
  await resolve(count, complete); await assertNoDialog();
  await page.evaluate(() => { window.fixture.hidden = true; window.fixture.now += 61_000; window.dispatchEvent(new Event('focus')); });
  await unchangedRequests(count + 1, 'hidden tabs do not refresh');
  await page.evaluate(() => { window.fixture.hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await waitRequests(count + 2); await assertNoDialog();
  await resolve(count + 1, photo); await photoButton().waitFor(); await focusInside();
  await backgroundRefresh(); await waitRequests(count + 3); await photoButton().waitFor();
  await reject(count + 2); await retryButton().waitFor(); await focusInside();
  await backgroundRefresh(); await unchangedRequests(count + 3, 'a failed refresh still requires explicit retry');
  await retryButton().click(); await waitRequests(count + 4); await pending();
  await resolve(count + 3, complete); await assertNoDialog();
  // Explicit mutation invalidation supersedes a background request as well.
  count = await requestCount(); await backgroundRefresh(); await waitRequests(count + 1); await assertNoDialog();
  await invalidate(); await waitRequests(count + 2); await pending();
  await resolve(count, complete); await pending();
  await resolve(count + 1, firstPost); await postButton().waitFor();
  await page.evaluate(() => { Date.now = window.fixture.realNow; delete document.visibilityState; });
  await update({user:null}); await assertNoDialog();

  // Shared Dialog retains focus even when there are no controls to tab into.
  await update({empty:true}); await page.getByText('Waiting without controls').waitFor(); await focusInside();
  for (const key of ['Tab','Shift+Tab']) {
    await page.locator('#background').focus(); await page.keyboard.press(key); await focusInside();
  }
  await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await page.evaluate(() => window.fixture.backgroundClicks), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: real React popup/Dialog; silent pending checks; error retry; focus and non-dismissal; zero-read route/auth snapshot/remount stability; member/session ABA and stale generations; unmounted logout/invalidation; authoritative photo/post ordering; ticket/purchase exemptions; verification priority; throttled background freshness.');
}

(async () => {
  const build = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {useValue} from 'profile-fixture';import {Dialog} from '@dvnt/ui';
      import {ProfileCompletionPopup} from './apps/web/src/components/profile-completion-popup';
      import {invalidateProfileCompletion} from '@dvnt/app/lib/profile/profile-completion-invalidation';
      import {publishSessionBoundary} from '@dvnt/app/lib/auth/session-lifecycle';
      window.fixture.publishSessionBoundary=publishSessionBoundary;
      window.fixture.invalidateProfileCompletion=invalidateProfileCompletion;
      function Fixture(){const {empty,mounted,hostKey}=useValue(s=>s);return <><button id="background" onClick={()=>window.fixture.backgroundClicks++}>Background action</button>{empty?<Dialog open hideClose dismissible={false} onClose={()=>{}} labelledBy="empty-title"><h2 id="empty-title">Waiting without controls</h2></Dialog>:mounted?<ProfileCompletionPopup key={hostKey}/>:null}</>}
      createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: ROOT, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' } },
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'explicit-profile-fixtures', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (Object.hasOwn(boundaries,args.path)) return {path:args.path,namespace:'fixture'};
        if (args.path === '@dvnt/ui') return {path:path.join(ROOT,'packages/ui/src/form/Dialog.web.tsx')};
        if (args.path === '@dvnt/app/lib/auth/session-lifecycle') return {path:path.join(ROOT,'packages/app/lib/auth/session-lifecycle.ts')};
        if (args.path.startsWith('@dvnt/app/lib/profile/')) return {path:path.join(ROOT,'packages/app/lib/profile',args.path.split('/').at(-1)+'.ts')};
      });
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:boundaries[args.path],loader:'tsx',resolveDir:ROOT}));
    }}],
  });
  const html = '<!doctype html><style>body{font:16px system-ui;background:#080910;color:white}[role=dialog]{position:fixed;inset:0;padding:40px;background:#101321;z-index:100}button{padding:12px;margin:8px}</style><div id="root"></div>';
  if (process.argv.includes('--dom')) {
    const {JSDOM,VirtualConsole} = require('jsdom');
    const errors = [], virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error.message));
    const dom = new JSDOM(html, {url:'https://fixture.invalid',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
    dom.window.MessageChannel = class {constructor(){this.port1={onmessage:null};this.port2={postMessage:()=>setTimeout(()=>this.port1.onmessage?.(),0)}}};
    try {
      dom.window.eval(build.outputFiles[0].text);
      await runScenarios(createDOMPage(dom.window), errors);
      console.log('DOM fallback only: native browser layout/keyboard behavior still requires the default Chromium run.');
    } finally { dom.window.close(); }
    return;
  }
  let chromium;
  try { ({chromium} = require('playwright')); } catch { ({chromium} = require('@playwright/test')); }
  const server = http.createServer((req,res) => {
    if (req.url === '/bundle.js') { res.writeHead(200, {'Content-Type':'text/javascript'}); return res.end(build.outputFiles[0].contents); }
    res.writeHead(200, {'Content-Type':'text/html'}); res.end(html + '<script src="/bundle.js"></script>');
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  let browser;
  try {
    browser = await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await runScenarios(page, errors);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
