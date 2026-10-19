#!/usr/bin/env node
// Real author controls with synthetic Payload context/network. Native Payload
// ownership and database behavior are covered separately by the HTTP fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const paths = [ROOT, path.join(ROOT, 'apps/web'), ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
const load = name => require(require.resolve(name, { paths }));
const out = process.env.AUTHOR_PROFILE_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'author-profile-ui-'));
fs.mkdirSync(out, { recursive: true });
async function build() {
  const { outputFiles } = await load('esbuild').build({
    stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import AuthorProfileLink from './packages/cms/src/components/AuthorProfileLink';import PostAuthorProfile from './packages/cms/src/components/PostAuthorProfile';import {FixtureProvider}from'@payloadcms/ui';function App(){const[show,setShow]=useState(true);return <FixtureProvider><h1>Writer account</h1><button onClick={()=>setShow(false)}>Leave editor</button>{show&&<><section aria-label="Account"><AuthorProfileLink/></section><section aria-label="Post"><h2>Authors and contributors</h2><PostAuthorProfile/></section></>}</FixtureProvider>}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: ROOT, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', jsxImportSource: 'react',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' } },
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: paths.flatMap(p => [p, path.join(p, 'node_modules')]),
    plugins: [{ name: 'isolated-payload-context', setup(b) {
      b.onResolve({ filter: /^@payloadcms\/ui$/ }, () => ({ path: 'ui', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'tsx', resolveDir: ROOT, contents: `import React,{createContext,useContext,useState}from'react';const Form=createContext(null);export function FixtureProvider({children}){const[value,setValue]=useState([1]);const[id,setID]=useState('fixture-post');return <Form.Provider value={{value,setValue,id}}><button onClick={()=>{setID('another-post');setValue([1])}}>Switch post</button>{children}<output aria-label="Primary author IDs">{JSON.stringify(value)}</output></Form.Provider>}export const useAuth=()=>({user:{id:3,role:'moderator',collection:'admin-users'}});export const useField=()=>useContext(Form);export const useDocumentInfo=()=>({id:useContext(Form).id});` }));
    } }],
  });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font:16px system-ui;background:#151515;color:#eee;max-width:900px;margin:auto;padding:24px}section{border:1px solid #555;border-radius:12px;padding:20px;margin:20px 0}button{font:inherit;padding:12px;border:1px solid #999;border-radius:8px;cursor:pointer}button:disabled{opacity:.6}a{color:#87b5ff}output{display:block;padding:12px;background:#252525}</style></head><body><div id="root"></div><script>${outputFiles[0].text.replaceAll('</script>', '<\\/script>')}</script></body></html>`;
}
async function run(browser, name, viewport, isMobile, origin) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  let calls = 0, mode = 'success', release, arrived;
  const press = locator => isMobile ? locator.tap() : locator.click();
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, origin, 'No external service requests');
    if (url.pathname !== '/payload-api/authors/me/profile') return route.continue();
    calls++; assert.equal(request.method(), 'POST'); assert.deepEqual(request.postDataJSON(), {});
    assert.equal(request.headers()['content-type'], 'application/json');
    if (mode === 'pending') await new Promise(resolve => { release = resolve; arrived?.(); });
    await route.fulfill({ status: mode === 'error' ? 403 : 200, json: mode === 'error'
      ? { errors: [{ message: 'Please sign in again.' }] }
      : { author: { id: 42, name: 'Real fixture writer' }, editURL: '/admin/collections/authors/42' } });
  });
  const loadPage = () => page.goto(origin + '/fixture');
  try {
    await loadPage();
    mode = 'pending'; const requestStarted = new Promise(resolve => { arrived = resolve; });
    await press(page.getByRole('button', { name: 'Set me as author', exact: true }));
    await requestStarted;
    assert.equal(await page.getByRole('button', { name: 'Loading your profile…' }).isDisabled(), true);
    // A repeat DOM event while awaiting the server must not provision twice.
    await page.getByRole('button', { name: 'Loading your profile…' }).evaluate(el => el.click());
    assert.equal(calls, 1);
    mode = 'success'; release();
    await page.getByRole('status').filter({ hasText: 'By Real fixture writer.' }).waitFor();
    assert.equal(await page.getByLabel('Primary author IDs').textContent(), '[42]');
    assert.equal(page.url(), origin + '/fixture');
    const edit = page.getByRole('link', { name: 'Edit author profile' });
    assert.equal(await edit.getAttribute('href'), '/admin/collections/authors/42');
    assert.equal(await edit.getAttribute('target'), '_blank');
    await page.screenshot({ path: path.join(out, `${name}-set-author.png`), fullPage: true });

    await loadPage(); mode = 'error';
    await press(page.getByRole('button', { name: 'Set me as author', exact: true }));
    await page.getByRole('alert').filter({ hasText: 'Please sign in again.' }).waitFor();
    assert.equal(await page.getByLabel('Primary author IDs').textContent(), '[1]');
    mode = 'success'; await press(page.getByRole('button', { name: 'Set me as author', exact: true }));
    await page.getByRole('status').filter({ hasText: 'By Real fixture writer.' }).waitFor();
    assert.equal(await page.getByLabel('Primary author IDs').textContent(), '[42]');

    for (const label of ['Set me as author', 'My author profile']) {
      await loadPage(); mode = 'pending';
      const pendingRequest = new Promise(resolve => { arrived = resolve; });
      await press(page.getByRole('button', { name: label, exact: true })); await pendingRequest;
      await press(page.getByRole('button', { name: 'Leave editor', exact: true }));
      mode = 'success'; release();
      await page.waitForTimeout(100);
      assert.equal(await page.getByLabel('Primary author IDs').textContent(), '[1]', 'Late result must not change another form');
      assert.equal(page.url(), origin + '/fixture', 'Late result must not navigate away from a newer screen');
    }
    await loadPage(); mode = 'pending';
    const switchingRequest = new Promise(resolve => { arrived = resolve; });
    await press(page.getByRole('button', { name: 'Set me as author', exact: true })); await switchingRequest;
    await press(page.getByRole('button', { name: 'Switch post', exact: true }));
    mode = 'success'; release(); await page.waitForTimeout(100);
    assert.equal(await page.getByLabel('Primary author IDs').textContent(), '[1]', 'Retained control must not change a newer document');
    await page.getByRole('button', { name: 'Set me as author', exact: true }).waitFor();
    await loadPage(); mode = 'pending';
    const navigationRequest = new Promise(resolve => { arrived = resolve; });
    await press(page.getByRole('button', { name: 'My author profile', exact: true })); await navigationRequest;
    await page.evaluate(() => history.pushState({}, '', '/newer-admin-screen'));
    mode = 'success'; release(); await page.waitForTimeout(100);
    assert.equal(page.url(), origin + '/newer-admin-screen', 'Persistent navigation must ignore an old response');
    await page.getByRole('button', { name: 'My author profile', exact: true }).waitFor();
    await loadPage(); mode = 'error';
    await press(page.getByRole('button', { name: 'My author profile', exact: true }));
    await page.getByRole('alert').waitFor();
    mode = 'success'; await press(page.getByRole('button', { name: 'My author profile', exact: true }));
    await page.waitForURL(origin + '/admin/collections/authors/42');
    await page.goBack();
    await page.getByRole('button', { name: 'My author profile', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ name, calls, results: ['explicit field update', 'duplicate-click guard', 'failure and retry', 'late-response guard', 'profile navigation and Back'], syntheticPayloadContext: true }, null, 2));
    console.log(`PASS ${name}: profile and attribution, repeat click, failure/retry, unmount, navigation/Back`);
  } finally { await context.close(); }
}
(async () => {
  const html = await build();
  if (process.argv.includes('--build-only')) return console.log(`PASS author controls bundle (${html.length} bytes)`);
  const server = http.createServer((req,res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const engine of ['chromium', 'webkit']) {
      const browser = await load('playwright')[engine].launch({ headless: true });
      try { await run(browser, `${engine}-375`, { width: 375, height: 812 }, true, origin); await run(browser, `${engine}-1440`, { width: 1440, height: 900 }, false, origin); }
      finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
