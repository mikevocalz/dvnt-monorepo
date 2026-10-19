// Mount the real console Gate, shared logout view, coordinator and Payload client.
// Only app-auth IO, app-store and unrelated console screens are fixtures. All
// requests stay on a disposable localhost server; no accounts/tokens are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const { chromium } = require('@playwright/test');
const ROOT = path.resolve(__dirname, '..');
const boundaries = {
  '@dvnt/app/lib/auth-client': `
    export const clearAllCachedData=()=>{window.fixture.appCacheCleared=true};
    export const signOut=async()=>{const r=await fetch('/api/auth/sign-out',{method:'POST'});return r.json()};`,
  '@dvnt/app/lib/stores/auth-store': `
    const state={user:{id:'fixture'},isAuthenticated:true,authStatus:'authenticated',setUser(user){state.user=user;state.isAuthenticated=!!user;state.authStatus=user?'authenticated':'unauthenticated'}};
    export const useAuthStore={getState:()=>state};`,
};
(async () => {
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {AdminApp} from './apps/web/src/dashboard/AdminApp';
      import {AdminSignOut} from './apps/web/src/dashboard/AdminSignOut';
      import {adminQueryClient} from './apps/web/src/dashboard/lib/admin-session';
      import {useAuthStore} from '@dvnt/app/lib/stores/auth-store';
      window.fixture={client:adminQueryClient,auth:useAuthStore.getState()};
      adminQueryClient.setQueryData(['private-admin-records'],['fixture-private']);
      createRoot(document.getElementById('root')).render(<React.StrictMode>{location.pathname==='/admin/logout'?<AdminSignOut/>:<AdminApp/>}</React.StrictMode>);`,
      resolveDir: ROOT, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' } },
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_PAYLOAD_URL': '""' },
    plugins: [{ name: 'admin-boundaries', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (Object.hasOwn(boundaries, args.path)) return { path: args.path, namespace: 'fixture' };
        if (args.importer.endsWith('/AdminApp.tsx') && args.path.startsWith('./screens/')) return { path: args.path.split('/').at(-1), namespace: 'screen' };
        if (args.path.endsWith('.css')) return { path: args.path, namespace: 'css' };
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: boundaries[args.path], loader: 'tsx', resolveDir: ROOT }));
      build.onLoad({ filter: /.*/, namespace: 'screen' }, args => ({ contents: `export const ${args.path}=()=> <p>Private admin data</p>`, loader: 'tsx', resolveDir: ROOT }));
      build.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: '', loader: 'js' }));
    } }],
  });
  let state;
  const reset = patch => { state = { app: true, cms: true, failApp: false, failPayload: false, calls: [], ...patch }; };
  reset();
  const server = http.createServer((req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.url === '/bundle.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle.outputFiles[0].contents); }
    if (req.url.startsWith('/payload-api/') || req.url === '/api/auth/sign-out') {
      state.calls.push(req.url);
      if (req.url === '/payload-api/admin-users/me') return json(200, { user: state.app || state.cms ? { id: 'fixture', role: 'admin' } : null });
      if (req.url === '/payload-api/admin-users/logout') {
        if (state.failPayload) return json(503, { errors: [{ message: 'fixture outage' }] });
        if (!state.cms && !state.app) return json(400, { errors: [{ message: 'No User' }] });
        state.cms = false; return json(200, { message: 'Logged out' });
      }
      if (req.url === '/api/auth/sign-out') {
        if (state.failApp) return json(503, { error: { message: 'fixture outage' } });
        state.app = false; return json(200, { data: { success: true } });
      }
      return json(404, {});
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    if (req.url.startsWith('/auth/login')) return res.end('<!doctype html><h1>DVNT login</h1>');
    res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext();
    const unexpected = [];
    await context.route('**/*', route => {
      if (!route.request().url().startsWith(origin + '/')) { unexpected.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const enter = async () => { await page.goto(origin + '/admin'); await page.getByText('Private admin data', { exact: true }).waitFor(); };
    const signOut = () => page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const login = () => page.waitForURL(url => url.pathname === '/auth/login');
    const warning = async () => {
      await page.getByRole('heading', { name: 'Sign-out could not be confirmed' }).waitFor();
      assert.equal(await page.getByText('Private admin data', { exact: true }).count(), 0);
      assert.deepEqual(await page.evaluate(() => ({ user: window.fixture.auth.user, cache: window.fixture.client.getQueryCache().getAll().length, appCacheCleared: window.fixture.appCacheCleared })), { user: null, cache: 0, appCacheCleared: true });
    };

    reset({ cms: false }); // SSO-only: an unauthenticated Payload logout is verified safely.
    await enter(); await signOut(); await login();
    assert.equal(state.app, false); assert.equal(state.cms, false);
    assert.ok(state.calls.indexOf('/api/auth/sign-out') < state.calls.indexOf('/payload-api/admin-users/logout'));
    assert.equal(state.calls.filter(p => p === '/api/auth/sign-out').length, 1, 'StrictMode cannot duplicate logout');
    await page.goto(origin + '/admin');
    await page.getByRole('link', { name: 'Continue with DVNT', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('link', { name: 'Continue with DVNT', exact: true }).waitFor();
    console.log('PASS: SSO-only logout, remount/refresh, ordering, StrictMode');

    reset({ failApp: true }); await enter(); await signOut(); await warning();
    assert.equal(state.app, true, 'fixture proves a failed app signout leaves the server session active');
    state.failApp = false;
    await page.getByRole('button', { name: 'Retry sign-out' }).click(); await login();
    console.log('PASS: Better Auth failure does not claim success; retry works');

    reset({ failPayload: true }); await enter(); await signOut(); await warning();
    assert.equal(state.cms, true); assert.equal(state.app, false);
    state.failPayload = false;
    await page.getByRole('button', { name: 'Retry sign-out' }).click(); await login();
    console.log('PASS: Payload partial failure is detected by fresh server verification');

    for (const sessions of [{ app: true, cms: false }, { app: false, cms: false }, { app: false, cms: true }]) {
      reset(sessions); await page.goto(origin + '/admin/logout');
      await page.getByRole('heading', { name: 'Sign out of DVNT?' }).waitFor();
      assert.deepEqual(state.calls, [], 'a direct or cross-site route visit cannot trigger logout');
      assert.equal(state.app, sessions.app); assert.equal(state.cms, sessions.cms);
      await page.getByRole('button', { name: 'Sign out of DVNT', exact: true }).click(); await login();
      assert.equal(state.app, false); assert.equal(state.cms, false);
    }
    console.log('PASS: Payload logout requires confirmation and handles SSO, expired and local-only sessions');
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
