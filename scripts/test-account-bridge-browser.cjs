// Real Chromium, production account/session/bridge modules, and real supabase-js.
// Only Better Auth IO, platform/store, and localhost Supabase wiring are fixtures.
// No production endpoint is reachable: every browser request is origin-allowlisted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch { ({ chromium } = require('playwright')); }
const ROOT = path.resolve(__dirname, '..');
const ANON = 'fixture-anon-key';
const jwt = (sub, lifetime = 3600) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + lifetime })).toString('base64url')}.fixture-signature`;
const decode = token => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub; } catch { return null; } };
let state;
const reset = patch => { state = { account: 'A', failSession: false, failMint: false, failLogout: false, lifetimeA: 3600, holdA: false, held: [], calls: [], ...patch }; };
reset();
const boundaries = {
  '@dvnt/auth': `const io=async(path,body)=>{const r=await fetch('/fixture/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const result=await r.json();if(path==='session'&&window.fixture)window.fixture.sessionReads++;return result}; export const authClient={getSession:()=>io('session'),signIn:{email:args=>io('login',args)},signUp:{email:args=>io('login',args)},signOut:()=>io('logout'),useSession:()=>({})};`,
  'fixture-store': `let user={id:'1',authId:'A',email:'a@example.test'};const listeners=new Set();export const useAuthStore={getState:()=>({user}),subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)}};export function setUser(next){user=next;for(const f of listeners)f()}`,
  'react-native': `export const Platform={OS:'web'};`,
  'expo-secure-store': `export const deleteItemAsync=async()=>{};`,
  '@tanstack/react-query': `export class QueryClient {}`,
  'fixture-supabase': `import {createClient} from '@supabase/supabase-js';import {createBridgeTransport} from './packages/supabase/src/bridge-transport';export const transport=createBridgeTransport('${ANON}');export const setBridgeAccessToken=transport.setToken;export const setBridgeTokenMinter=transport.setMinter;export const supabase=createClient(location.origin,'${ANON}',{accessToken:transport.accessToken,global:{fetch:(input,init)=>{const hook=window.fixture?.beforeDispatch;if(hook){window.fixture.beforeDispatch=null;hook()}return transport.guardFetch(fetch.bind(window))(input,init)}}});`,
};
(async () => {
  let bundle;
  const server = http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.url === '/bundle.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle); }
    const body = await new Promise(resolve => { let data = ''; req.on('data', chunk => data += chunk); req.on('end', () => resolve(data)); });
    if (req.url.startsWith('/fixture/auth/')) {
      const input = JSON.parse(body || '{}');
      if (req.url.endsWith('/logout')) { if (state.failLogout) return json(200, { error: { message: 'fixture outage' } }); state.account = null; return json(200, { data: { success: true } }); }
      if (req.url.endsWith('/login')) state.account = input.account;
      if (state.failSession && req.url.endsWith('/session')) return json(200, { error: { message: 'fixture outage' } });
      const a = state.account;
      return json(200, { data: a ? { user: { id: a, email: `${a.toLowerCase()}@example.test` }, session: { token: `session-${a}`, expiresAt: new Date(Date.now() + 86400000).toISOString() } } : null });
    }
    if (req.url === '/functions/v1/mint-supabase-jwt') {
      const account = req.headers['x-auth-token']?.replace('session-', '');
      state.calls.push({ kind: 'mint', account });
      const respond = () => state.failMint ? json(503, {}) : json(200, { ok: true, data: { access_token: jwt(account, account === 'A' ? state.lifetimeA : 3600) } });
      if (state.holdA && account === 'A') state.held.push(respond); else respond();
      return;
    }
    if (req.url.startsWith('/rest/v1/')) {
      const token = req.headers.authorization?.replace(/^Bearer /i, '');
      const account = decode(token);
      state.calls.push({ kind: 'rest', method: req.method, account, token, url: req.url, body, bridgeEpoch: req.headers['x-dvnt-bridge-epoch'] });
      if (!account) return json(401, { message: 'Unauthenticated fixture request', code: '42501' });
      const owner = new URL(req.url, 'http://localhost').searchParams.get('owner_id');
      if (req.method === 'PATCH' && owner !== `eq.${account}`) return json(403, { message: 'Owner mismatch', code: '42501' });
      return json(200, [{ id: 'fixture-event', owner_id: account, ...JSON.parse(body || '{}') }]);
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><title>Account bridge regression</title><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    const built = await esbuild.build({
      stdin: { contents: `
        import * as auth from './packages/app/lib/auth-client.web';
        import * as bridge from './packages/app/lib/auth/supabase-jwt';
        import {getSessionLifecycle} from './packages/app/lib/auth/session-lifecycle';
        import {setUser} from 'fixture-store';
        import {supabase,transport} from 'fixture-supabase';
        const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
        window.fixture={...auth,...bridge,sessionReads:0,transport,lifecycle:getSessionLifecycle,advance:ms=>offset+=ms,
          setUser:account=>setUser(account?{id:account==='A'?'1':'2',authId:account,email:account.toLowerCase()+'@example.test'}:null),
          login:async account=>{await auth.signIn.email({account});window.fixture.setUser(account)},
          patch:owner=>supabase.from('events').update({flyer:'fixture-new-flyer.jpg'}).eq('owner_id',owner).select().setHeader('x-dvnt-bridge-epoch',transport.requestEpoch()),
          capturePatch:owner=>{window.capturedPatch=supabase.from('events').update({flyer:'captured.jpg'}).eq('owner_id',owner).select().setHeader('x-dvnt-bridge-epoch',transport.requestEpoch())},
          read:()=>supabase.from('events').select('*'),
          oldDispatch:token=>transport.guardFetch(fetch.bind(window))(location.origin+'/rest/v1/events',{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'}).then(()=>false,()=>true)};
      `, resolveDir: ROOT, loader: 'ts' },
      bundle: true, write: false, platform: 'browser', format: 'iife',
      nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
      define: { 'process.env.NODE_ENV': '"test"', 'process.env.EXPO_PUBLIC_SUPABASE_URL': JSON.stringify(origin), 'process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(ANON) },
      plugins: [{ name: 'account-bridge-boundaries', setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          let key = args.path;
          if (/\/(stores\/auth-store)$/.test(key)) key = 'fixture-store';
          if (key === '../supabase/client' || key === '@dvnt/supabase') key = 'fixture-supabase';
          if (key === '../auth-client') return { path: path.join(ROOT, 'packages/app/lib/auth-client.web.ts') };
          if (Object.hasOwn(boundaries, key)) return { path: key, namespace: 'fixture' };
        });
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: boundaries[args.path], loader: 'ts', resolveDir: ROOT }));
      } }],
    });
    bundle = built.outputFiles[0].contents;
    browser = await chromium.launch({ headless: true, ...(fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const unexpected = [];
    const errors = [];
    const context = await browser.newContext();
    await context.route('**/*', route => {
      if (!route.request().url().startsWith(origin + '/')) { unexpected.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    let page;
    const enter = async (patch = {}) => {
      // Each server reset starts an independent scenario, not an application
      // account transition. Dispose the previous document BEFORE changing its
      // mocked session: focus/visibility revalidation and sign-out listeners
      // must not race the next scenario's server state. Real transitions stay
      // within one page below; the context/storage are still shared for the
      // persisted-token and explicit two-tab cases.
      await page?.close();
      reset(patch);
      page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => !!window.fixture);
      assert.equal(await page.evaluate(() => window.fixture.lifecycle().ready), true,
        'independent scenario must not inherit the previous document sign-out lock');
      assert.equal(state.account, patch.account ?? 'A', 'the previous scenario must not change the reset server session');
    };
    const rest = () => state.calls.filter(call => call.kind === 'rest');
    const ensure = () => page.evaluate(() => window.fixture.ensureSupabaseJwt());
    const patch = account => page.evaluate(a => window.fixture.patch(a), account);
    const assertOwner = (result, account) => { assert.equal(result.error, null); assert.equal(result.data[0].owner_id, account); assert.equal(rest().at(-1).account, account); assert.equal(rest().at(-1).bridgeEpoch, undefined, 'internal epoch header must be stripped'); };

    for (const expired of [false, true]) {
      await enter({ lifetimeA: expired ? 60 : 3600 }); assert.equal(await ensure(), true);
      assertOwner(await patch('A'), 'A');
      const oldToken = rest().at(-1).token;
      if (expired) await page.evaluate(() => window.fixture.advance(90000));
      await page.evaluate(() => window.fixture.login('B'));
      const mark = rest().length;
      assert.equal(await page.evaluate(token => window.fixture.oldDispatch(token), oldToken), true);
      assert.equal(rest().length, mark, 'stale bearer must be rejected before network dispatch');
      assertOwner(await patch('B'), 'B');
      assert.ok(rest().slice(mark).every(call => call.account !== 'A'));
      console.log(`PASS: ${expired ? 'expired' : 'nonexpired'} A → B, old bearer blocked, owner B PATCH`);
    }

    await enter(); assert.equal(await ensure(), true);
    const dispatchMark = rest().length;
    await page.evaluate(() => { window.fixture.beforeDispatch = () => window.fixture.setUser('B'); });
    assert.ok((await patch('A')).error);
    assert.equal(rest().length, dispatchMark, 'account change after SDK bearer selection must block actual PATCH');
    await page.evaluate(() => window.fixture.login('B'));
    assertOwner(await patch('B'), 'B');
    console.log('PASS: SDK-selected A bearer invalidated immediately before real fetch dispatch');

    await enter(); assert.equal(await ensure(), true);
    await page.evaluate(() => window.fixture.capturePatch('A'));
    await page.evaluate(() => window.fixture.login('B'));
    const epochMark = rest().length;
    assert.ok((await page.evaluate(() => window.capturedPatch)).error);
    assert.equal(rest().length, epochMark, 'request created under A must not dispatch with B bearer');
    assertOwner(await patch('B'), 'B');
    console.log('PASS: request epoch blocks deferred A PATCH even after SDK selects B');

    await enter();
    const initial = await page.evaluate(() => Promise.all(Array.from({length:8},()=>window.fixture.ensureSupabaseJwt())));
    assert.ok(initial.every(Boolean));
    assert.equal(state.calls.filter(call=>call.kind==='mint'&&call.account==='A').length,1,'initial calls must coalesce');
    await page.evaluate(() => window.fixture.login('B'));
    const switched = await page.evaluate(() => Promise.all(Array.from({length:8},()=>window.fixture.ensureSupabaseJwt())));
    assert.ok(switched.every(Boolean));
    assert.equal(state.calls.filter(call=>call.kind==='mint'&&call.account==='B').length,1,'calls after store transition must coalesce');
    assertOwner(await patch('B'), 'B');
    console.log('PASS: concurrent initial and post-login bridge requests coalesce per account');

    for (const event of ['focus', 'visibilitychange']) {
      await enter(); await page.bringToFront(); assert.equal(await ensure(), true);
      const before = await page.evaluate(() => ({ epoch: window.fixture.lifecycle().epoch, reads: window.fixture.sessionReads }));
      await page.evaluate(kind => {
        window.fixture.capturePatch('A');
        if (kind === 'focus') window.dispatchEvent(new Event('focus'));
        else {
          if (document.visibilityState !== 'visible') throw new Error('Visibility fixture must be visible');
          document.dispatchEvent(new Event('visibilitychange'));
        }
      }, event);
      await page.waitForFunction(reads => window.fixture.sessionReads > reads, before.reads);
      assert.equal(await page.evaluate(() => window.fixture.lifecycle().epoch), before.epoch, 'same-account revalidation cannot cancel editor work');
      assertOwner(await page.evaluate(() => window.capturedPatch), 'A');
      console.log(`PASS: same-account ${event} verifies session without invalidating pending PATCH`);
    }

    await enter({ holdA: true });
    await page.evaluate(() => { window.pendingMint = window.fixture.ensureSupabaseJwt(); });
    // Poll server-side to ensure A is genuinely in flight.
    await waitFor(() => state.held.length === 1);
    await page.evaluate(() => window.fixture.login('B'));
    assertOwner(await patch('B'), 'B');
    state.held.splice(0).forEach(release => release());
    assert.equal(await page.evaluate(() => window.pendingMint), false);
    assertOwner(await patch('B'), 'B');
    assert.ok(rest().every(call => call.account === 'B'));
    console.log('PASS: late in-flight A mint cannot refill B cache or reach REST');

    for (const failLogout of [false, true]) {
      await enter({ failLogout }); assert.equal(await ensure(), true);
      await page.evaluate(() => window.fixture.signOut());
      const logoutMark = rest().length;
      const result = await patch('A');
      assert.ok(result.error); assert.ok(rest().slice(logoutMark).every(call => call.account === null));
      assert.equal(await ensure(), false);
      console.log(`PASS: ${failLogout ? 'failed' : 'successful'} logout detaches the bridge`);
    }

    await enter(); assert.equal(await ensure(), true);
    await page.evaluate(() => window.fixture.advance(51 * 60 * 1000));
    state.failMint = true;
    const refreshMark = rest().length;
    assert.equal(await ensure(), false);
    assert.ok((await patch('A')).error);
    assert.ok(rest().slice(refreshMark).every(call => call.account === null));
    console.log('PASS: failed JWT refresh detaches still-valid old token with no fallback');

    await enter(); assert.equal(await ensure(), true);
    state.failSession = true;
    await page.evaluate(() => window.fixture.invalidateTokenCache());
    assert.equal(await ensure(), false);
    const errorMark = rest().length;
    assert.ok((await patch('A')).error);
    assert.ok(rest().slice(errorMark).every(call => call.account === null));
    console.log('PASS: session error fails closed without reusing bridge A');

    await context.addInitScript(token => localStorage.setItem('dvnt-supabase-jwt-v1', JSON.stringify({ accessToken: token, expiresAt: 9999999999 })), jwt('A'));
    await enter({ account: 'B' }); await page.evaluate(() => window.fixture.setUser('B'));
    assertOwner(await patch('B'), 'B');
    assert.equal(await page.evaluate(() => localStorage.getItem('dvnt-supabase-jwt-v1')), null);
    assert.ok(rest().every(call => call.account === 'B'));
    console.log('PASS: cold persisted A JWT ignored and removed under session B');

    // Two real tabs share origin storage but not memory or auth-store state.
    await enter(); assert.equal(await ensure(), true);
    const other = await context.newPage(); await other.goto(origin); await other.waitForFunction(() => !!window.fixture);
    const beforeEpoch = await page.evaluate(() => window.fixture.lifecycle().epoch);
    await other.evaluate(() => window.fixture.signOut());
    await page.waitForFunction(epoch => window.fixture.lifecycle().epoch > epoch, beforeEpoch);
    assert.equal(await ensure(), false);
    const crossTabMark = rest().length;
    assert.ok((await patch('A')).error); assert.ok(rest().slice(crossTabMark).every(call => call.account === null));
    await other.close();
    console.log('PASS: real cross-tab logout signal invalidates attached A credential');
    assert.deepEqual(unexpected, [], 'no production or other external network requests');
    assert.deepEqual(errors, []);
  } finally {
    state.held.splice(0).forEach(release => release());
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
async function waitFor(test) { const until = Date.now() + 5000; while (!test()) { if (Date.now() > until) throw new Error('Fixture condition timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } }
