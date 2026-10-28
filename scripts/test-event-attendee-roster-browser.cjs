#!/usr/bin/env node
// Real accordion + real Zustand paging store. Synthetic event/member fixtures,
// API/auth boundaries only; no live accounts, checkout, or Supabase requests.
// NODE_PATH points at isolated tools. --build-only and --smoke need no local socket/browser.
// --smoke checks the compiled DOM bundle in jsdom, not rendered geometry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const dependencyPaths = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), ROOT];
const load = name => require(require.resolve(name, { paths: dependencyPaths }));
const OUT = process.env.ATTENDEE_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-attendee-evidence-'));
const browserName = process.env.ATTENDEE_BROWSER || 'chromium';
const fixture = `
  import {create} from 'zustand';
  export const person=id=>({id:String(id),username:'member-'+id,initials:'M'+id});
  export const all=Array.from({length:45},(_,i)=>person(i+1));
  export const scenario=new URLSearchParams(location.search).get('scenario')||'few';
  export const state=create(()=>({event:{category:'party'}}));
  export const f=window.fixture={requests:[],clicked:[],offline:scenario==='error',setEvent:event=>state.setState({event})};
  export const eventsApi={getEventAttendeePage:async(id,{offset,limit})=>{
    f.requests.push({id,offset,limit});
    if(f.offline)throw Error('Synthetic offline response');
    return scenario==='all'?all.slice(offset,offset+limit):[];
  }};
`;
const boundaries = new Map([
  ['fixture', fixture],
  ['@dvnt/app/lib/api/events', `export {eventsApi} from 'fixture';`],
  ['@dvnt/app/lib/auth/session-lifecycle', `export const getSessionLifecycle=()=>({epoch:1,ready:true});export const subscribeSessionLifecycle=()=>()=>{};`],
  ['@dvnt/app/lib/stores/auth-store', `export const useAuthStore=select=>select({isAuthenticated:true});`],
]);

(async () => {
  const built = await load('esbuild').build({
    stdin: { resolveDir: ROOT, loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {GoingAccordion} from './packages/app/components/event/GoingAccordion.web';
      import {state,all,f} from 'fixture';
      function Fixture(){const event=state(s=>s.event);return <main><h1>Game Night · Synthetic fixture</h1><h2>Who's going</h2>
        <GoingAccordion event={event} id="42" eventId="42" attendees={all.slice(0,4)} totalCount={45} isLoggedIn onAttendeePress={row=>f.clicked.push(row.id)}/>
      </main>};createRoot(document.getElementById('root')).render(<Fixture/>);` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'attendee-service-boundaries', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (boundaries.has(args.path)) return { path: args.path, namespace: 'fixture' };
        if (args.path.startsWith('@dvnt/app/')) return build.resolve(path.join(ROOT, 'packages/app', args.path.slice('@dvnt/app/'.length)), { resolveDir: ROOT, kind: args.kind });
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: boundaries.get(args.path), loader: 'tsx', resolveDir: ROOT }));
    } }],
  });
  const js = built.outputFiles[0].text;
  assert.match(js, /member profiles/);
  if (process.argv.includes('--build-only')) { console.log('Actual attendee accordion/store browser bundle passed. Browser not run.'); return; }
  if (process.argv.includes('--smoke')) {
    const { JSDOM, VirtualConsole } = load('jsdom');
    const errors = [];
    for (const scenario of ['few', 'all', 'error']) {
      const console = new VirtualConsole();
      console.on('jsdomError', error => errors.push(String(error)));
      console.on('error', (...args) => errors.push(args.map(String).join(' ')));
      const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: `https://fixture.invalid/?scenario=${scenario}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
      try {
        dom.window.eval(js);
        const until = async predicate => {
          const end = Date.now() + 3000;
          while (!predicate()) { assert.ok(Date.now() < end, 'compiled DOM fixture reaches expected state'); await new Promise(resolve => setTimeout(resolve, 5)); }
        };
        await until(() => dom.window.document.querySelector('button[aria-expanded]'));
        dom.window.document.querySelector('button[aria-expanded]').click();
        if (scenario === 'error') {
          const retry = () => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Try again');
          await until(retry);
          dom.window.fixture.offline = false; retry().click();
          await until(() => !retry());
        } else await until(() => dom.window.document.body.textContent.includes(`${scenario === 'all' ? 45 : 4} member profiles shown`));
        assert.deepEqual(Array.from(dom.window.fixture.requests, request => request.offset), scenario === 'all' ? [4, 28] : scenario === 'error' ? [4, 4] : [4]);
      } finally { dom.window.close(); }
    }
    assert.deepEqual(errors, []);
    console.log('Compiled attendee browser fixture passed jsdom smoke. Browser geometry not run.'); return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('content-type', 'application/javascript'); res.end(js); return; }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
      *{box-sizing:border-box}body{margin:0;background:#06070d;color:#fff;font-family:system-ui,sans-serif}main{max-width:560px;margin:0 auto;padding:24px 16px}h1{font-size:20px;margin:0 0 36px}h2{font-size:17px;margin:0 0 14px}button{font-family:inherit}
      </style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  try {
    browser = await load('playwright')[browserName].launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const scenario of ['few', 'all', 'error']) {
      await page.goto(`${base}/?scenario=${scenario}`);
      const header = page.locator('button[aria-expanded]');
      await header.click();
      if (scenario === 'error') {
        await page.getByRole('button', { name: 'Try again' }).waitFor();
        await page.screenshot({ path: path.join(OUT, `${browserName}-attendee-retry.png`), fullPage: true });
        await page.evaluate(() => { window.fixture.offline = false; });
        await page.getByRole('button', { name: 'Try again' }).click();
        await page.waitForFunction(() => !document.body.textContent.includes("Couldn't load more"));
        assert.deepEqual(await page.evaluate(() => window.fixture.requests.map(r => r.offset)), [4, 4]);
      } else if (scenario === 'all') {
        await page.getByText('45 member profiles shown', { exact: true }).waitFor();
        await page.getByRole('button', { name: /member-45$/ }).click();
        assert.deepEqual(await page.evaluate(() => window.fixture.clicked), ['45']);
        assert.deepEqual(await page.evaluate(() => window.fixture.requests.map(r => r.offset)), [4, 28]);
      } else {
        await page.getByText('4 member profiles shown', { exact: true }).waitFor();
        assert.match(await page.locator('body').innerText(), /Only available member profiles/);
        assert.match(await page.locator('body').innerText(), /guest and additional tickets may not have a member profile/);
      }
      await page.screenshot({ path: path.join(OUT, `${browserName}-attendee-${scenario}.png`), fullPage: true });
      const requestCount = await page.evaluate(() => window.fixture.requests.length);
      await header.click(); await header.click();
      assert.equal(await page.evaluate(() => window.fixture.requests.length), requestCount);
      const bounds = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(bounds.scroll <= bounds.width, 'no horizontal overflow on mobile');
      await page.evaluate(() => window.fixture.setEvent({ category: 'sex_party', showAttendees: false }));
      await header.waitFor({ state: 'detached' });
      assert.doesNotMatch(await page.locator('body').innerText(), /member-\d/);
    }
    assert.deepEqual(errors, []);
    console.log(`${browserName}: 4/45 disclosure, full pagination, retry, reopen, mobile overflow, privacy revocation passed. Evidence: ${OUT}`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
