#!/usr/bin/env node
// Real EventsListScreen, unified EventsMap/MemberMap, Zustand, React Query and CSS.
// Provider, member-data, network/auth/router boundaries are synthetic; no Google requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { build } = require('esbuild');
const { compile } = require('tailwindcss');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const dir = process.env.EVENT_MAP_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-web-event-map-'));
fs.mkdirSync(dir, { recursive: true });
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const future = '2099-10-24T20:00:00Z';
const event = (id, title, extra = {}) => ({
  id: String(id), title, description: 'Synthetic browser fixture', date: future,
  fullDate: future, event_tz: 'America/Los_Angeles', location: 'Fixture venue',
  image: '', price: 0, attendees: 0, totalAttendees: 12,
  host: { id: 'fixture-host', username: 'fixture-host', avatar: '' },
  category: 'party', locationLat: 37.7749, locationLng: -122.4194, ...extra,
});
const all = [
  event(101, 'Harbor Lights', { location: 'Harbor room' }),
  event(102, 'Mission Night', { locationLat: 37.7599, locationLng: -122.4148 }),
  event(103, 'Harbor Afterparty', { location: 'Harbor room' }), // same coordinates
  event(104, 'Equator Zero', { locationLat: 0, locationLng: 0 }),
  event(201, 'Hidden venue', { isHidden: true, locationLat: -33.9, locationLng: 151.2 }),
  event(202, 'Private venue', { visibility: 'private', locationLat: -34.6, locationLng: -58.4 }),
  event(203, 'Unlisted venue', { visibility: 'link_only', locationLat: 51.5, locationLng: 0.1 }),
  event(204, 'Scheduled venue', { publishAt: '2099-12-31T23:59:59Z' }),
  event(205, 'Draft venue', { status: 'draft' }),
  event(206, 'Cancelled venue', { status: 'cancelled' }),
  event(207, 'Unverified venue'),
  event(301, 'Online session', { isOnline: true }),
  event(302, 'No coordinates', { locationLat: undefined, locationLng: undefined }),
  event(303, 'Invalid coordinates', { locationLat: 123, locationLng: -190 }),
];
const past = [event(401, 'Past Archive', { date: '2000-01-01T20:00:00Z', fullDate: '2000-01-01T20:00:00Z' })];
const forYou = [event(501, 'Personalized Night', { locationLat: 40.7128, locationLng: -74.006 })];
const longTitle = 'Harbor community celebration with live music, local artists, dancing and late-night conversations at the waterfront venue, featuring extended performances and community gatherings throughout the evening with a full programme of music, food, dancing and conversation';
const crowded = [event(601, longTitle), ...Array.from({ length: 7 }, (_, i) => event(602 + i, `Additional mapped event ${i + 1}`))];
const rawLocation = e => ({
  id: e.id, title: e.title, visibility: e.visibility || 'public',
  is_hidden: e.isHidden || false, publish_at: e.publishAt || null,
  status: e.status || 'active', is_online: e.isOnline || false,
  location_type: e.isOnline ? 'virtual' : 'physical', location: e.location,
  location_name: e.location, location_lat: e.locationLat ?? null,
  location_lng: e.locationLng ?? null,
});
const fixtureData = { all, past, forYou, locations: [...all, ...past, ...forYou].filter(e => e.id !== '207').map(rawLocation) };
const mocks = {
  './map-sharing-consent': `export const MapSharingConsent=()=>null;`,
  // Only persistence transport is synthetic; execute the real saved-city store.
  '@dvnt/app/lib/mmkv-zustand': `export const mmkvStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`,
  '@vis.gl/react-google-maps': require('./fixtures/member-map/google-overlay-boundary.cjs'),
  '@dvnt/app/lib/hooks/use-member-map': `export const useMapSharingConsent=()=>({busy:false,error:null,cancel:()=>{},share:()=>{throw Error('unexpected consent write')}});export const useLocationSettings=()=>({sharing:false,enabled:false,settings:{locationEnabled:false,eventsMapEnabled:false},loading:false,busy:false,error:null,setOverall:()=>{throw Error('unexpected consent write')},setSharing:()=>{throw Error('unexpected sharing write')}});export const useMemberMapPresence=()=>({error:null,isUpdating:false,refresh:()=>{throw Error('unexpected GPS request')}});export const useNearbyMembers=()=>({data:undefined,isError:false,isPending:false,refetch:()=>{}});`,
  'solito/navigation': `export const usePathname=()=>window.mapFixture.path; export const useRouter=()=>({push:p=>window.mapFixture.navigate(p),replace:p=>window.mapFixture.navigate(p,true),back:()=>history.back()});`,
  '@dvnt/app/lib/stores/auth-store': `import {useSyncExternalStore} from 'react'; const subscribe=cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)}; const current=()=>({isAuthenticated:window.mapFixture.authenticated,_hasHydrated:true,user:{id:'fixture-user'}}); export const useAuthStore=selector=>useSyncExternalStore(subscribe,()=>selector(current())); useAuthStore.getState=current;`,
  '@dvnt/app/lib/hooks/use-events': `import {useSyncExternalStore} from 'react'; const subscribe=cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)}; const useData=k=>({data:useSyncExternalStore(subscribe,()=>window.mapFixture.data[k]),isLoading:false}); export const useEvents=()=>useData('all'); export const usePastEvents=()=>useData('past'); export const useForYouEvents=()=>useData('forYou'); export const useToggleEventLike=()=>({mutate:()=>{throw Error('write forbidden in map fixture')}});`,
  '@dvnt/app/lib/hooks/use-event-realtime': `export const useEventsFeedRealtime=()=>{};`,
  '@dvnt/app/lib/hooks/use-promotions': `const ids=new Set(); export const useSpotlightFeed=()=>({data:[]}); export const usePromotedEventIds=()=>({data:ids});`,
  '@dvnt/app/lib/api/event-map': `export const eventMapApi={getLocations:async ids=>{const f=window.mapFixture;f.locationRequests.push([...ids]);if(f.locationError)throw Error('Synthetic location API failure');if(f.locationDelay)await new Promise(r=>setTimeout(r,f.locationDelay));return f.data.locations.filter(e=>ids.map(String).includes(String(e.id)));}};`,
};

async function verifyApiBoundary() {
  // Execute the real API module with only the Supabase transport replaced.
  const result = await build({
    entryPoints: [path.join(root, 'packages/app/lib/api/event-map.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false, tsconfigRaw: {},
    plugins: [{ name: 'supabase-boundary', setup(b) {
      b.onResolve({ filter: /supabase\/client$/ }, () => ({ path: 'supabase-boundary', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const supabase = globalThis.__eventMapSupabase;' }));
    } }],
  });
  let queries = [], failBatch = -1;
  const supabase = { from(table) {
    const record = { table, filters: [], ids: [], projection: null, signal: null };
    const builder = {
      select(projection) { record.projection = projection; return builder; },
      in(column, ids) { record.column = column; record.ids = ids; return builder; },
      or(filter) { record.filters.push(filter); return builder; },
      abortSignal(signal) { record.signal = signal; return builder; },
      then(resolve, reject) {
        queries.push(record);
        return Promise.resolve({ data: record.ids.map(id => ({ id })), error: queries.length === failBatch ? { message: 'Synthetic query error' } : null }).then(resolve, reject);
      },
    };
    return builder;
  } };
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, __eventMapSupabase: supabase });
  const { eventMapApi } = module.exports;
  const signal = new AbortController().signal;
  const ids = Array.from({ length: 205 }, (_, i) => String(i + 1));
  const rows = await eventMapApi.getLocations(ids, signal);
  assert.equal(rows.length, 205);
  assert.deepEqual(queries.map(q => q.ids.length), [100, 100, 5]);
  for (const query of queries) {
    assert.equal(query.table, 'events'); assert.equal(query.column, 'id');
    assert.equal(query.signal, signal, 'each metadata batch must propagate cancellation');
    assert.equal(query.projection, 'id,title,visibility,is_hidden,publish_at,status,is_online,location_type,location,location_name,location_lat,location_lng');
    assert.equal(query.filters.length, 6);
    assert.ok(query.filters.includes('visibility.is.null,visibility.eq.public'));
    assert.ok(query.filters.includes('is_hidden.is.null,is_hidden.eq.false'));
    assert.ok(query.filters.some(f => /^publish_at\.is\.null,publish_at\.lte\.\d{4}-\d{2}-\d{2}T/.test(f)));
    assert.ok(query.filters.includes('status.is.null,status.in.(active,postponed)'));
    assert.ok(query.filters.includes('is_online.is.null,is_online.eq.false'));
    assert.ok(query.filters.includes('location_type.is.null,location_type.neq.virtual'));
  }
  queries = [];
  await eventMapApi.getLocations(['1', '1', '0', '-1', '', 'not-an-id', '9007199254740992']);
  assert.equal(queries.length, 1);
  assert.deepEqual(Array.from(queries[0].ids), ['1']);
  queries = [];
  assert.equal((await eventMapApi.getLocations([])).length, 0);
  assert.equal(queries.length, 0);
  failBatch = 2;
  await assert.rejects(eventMapApi.getLocations(ids), /Event locations could not be loaded/);
  assert.equal(queries.length, 2, 'failed batch aborts subsequent requests and rejects, rather than returning partial data');
}

async function bundle() {
  await build({
    bundle: true, jsx: 'automatic', tsconfigRaw: {}, platform: 'browser', format: 'iife',
    outfile: path.join(dir, 'app.js'), loader: { '.png': 'dataurl', '.svg': 'dataurl' },
    define: {'process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY':JSON.stringify('synthetic-only'),'process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY':'undefined'},
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    resolveExtensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
    alias: { '@dvnt/app': path.join(root, 'packages/app'), 'react-native': 'react-native-web' },
    plugins: [{ name: 'map-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        if(args.path==='@dvnt/ui/google-maps-public-config')return {path:path.join(root,'packages/ui/src/google-maps-public-config.ts')};
        const key = mocks[args.path] ? args.path : Object.keys(mocks).find(k => k.startsWith('@dvnt/app/') && args.path === path.join(root, 'packages/app', k.slice('@dvnt/app/'.length)));
        if (key) return { path: key, namespace: 'mock' };
      });
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    } }],
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {EventsListScreen} from './packages/app/features/events/events-list.web';
      import {useEventsScreenStore} from './packages/app/lib/stores/events-screen-store';
      const data=${JSON.stringify(fixtureData)};
      const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
      const f=window.mapFixture={path:location.pathname,data,authenticated:true,locationError:false,locationDelay:0,locationRequests:[],store:useEventsScreenStore,queryClient};
      f.setData=patch=>{f.data={...f.data,...patch};queryClient.clear();dispatchEvent(new Event('fixturechange'));};
      f.setAuthenticated=value=>{f.authenticated=value;dispatchEvent(new Event('fixturechange'));};
      function App(){const [route,setRoute]=useState(location.pathname);f.path=route;
        f.navigate=(p,replace=false)=>{history[replace?'replaceState':'pushState']({},'',p);setRoute(p);};
        useEffect(()=>{const pop=()=>setRoute(location.pathname);addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop)},[]);
        return <QueryClientProvider client={queryClient}>{route==='/feed/events'?<EventsListScreen/>:<main><h1>Event route fixture</h1><p data-route>{route}</p><button onClick={()=>history.back()}>Back to events</button></main>}</QueryClientProvider>;
      }createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);` },
  });
  // Same Tailwind theme/preflight/important utilities and global brand CSS as web.
  const tw = path.dirname(require.resolve('tailwindcss/package.json'));
  const globals = read('apps/web/src/app/(frontend)/globals.css');
  const sources = ['packages/app/features/events/events-list.web.tsx', 'packages/app/features/events/ui/events-map.web.tsx','packages/app/features/events/ui/member-map.web.tsx','packages/app/features/events/ui/rounded-map-marker.web.tsx','packages/app/features/settings/ui/LocationControls.web.tsx'];
  const candidates = sources.flatMap(p => read(p).match(/[a-zA-Z0-9_!@#%./:[\](),+*=&<>-]+/g) || []);
  const compiler = await compile(fs.readFileSync(path.join(tw, 'theme.css'), 'utf8') + '\n' + fs.readFileSync(path.join(tw, 'preflight.css'), 'utf8') + '\n@tailwind utilities important;\n' + globals.slice(globals.indexOf('/* ── Deviant brand tokens')));
  fs.writeFileSync(path.join(dir, 'style.css'), compiler.build(candidates));
}

(async () => {
  let browser, server, page;
  const errors = [], browserConsole = [], failedRequests = [], blockedRequests = [], providerMarkers = [], geolocationCalls = [], viewportEvidence = [], fixedViewportEvidence = [], longTitleEvidence = [], checks = [];
  const check = name => { checks.push(name); console.log('PASS', name); };
  try {
    await verifyApiBoundary(); check('actual location API projection, admission filters, batch limit, abort signal and fail-closed errors');
    await bundle();
    if (process.argv.includes('--build-only')) { console.log('PASS production Events screen + unified map fixture bundle'); return; }
    server = http.createServer((req, res) => {
      const filename = ['/app.js', '/app.css', '/style.css'].includes(req.url) ? req.url.slice(1) : null;
      if (filename) {
        res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
        res.end(fs.existsSync(path.join(dir, filename)) ? fs.readFileSync(path.join(dir, filename)) : ''); return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (process.argv.includes('--serve')) { console.log(`Synthetic fixture: ${origin}/feed/events`); await new Promise(() => {}); }
    const engine = process.env.EVENT_MAP_BROWSER === 'webkit' ? webkit : chromium;
    browser = await engine.launch({ headless: true, ...(engine === chromium ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] } : {}) });
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await context.exposeBinding('reportFixtureMarker', (_source, marker) => providerMarkers.push(marker));
    await context.exposeBinding('reportFixtureGeolocation', (_source, name) => geolocationCalls.push(name));
    await context.addInitScript(() => {
      window.geolocationCalls = [];
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
        getCurrentPosition(...args) { window.geolocationCalls.push('getCurrentPosition'); window.reportFixtureGeolocation('getCurrentPosition'); args[1]?.({ code: 1, message: 'Forbidden in event-only map fixture' }); },
        watchPosition() { window.geolocationCalls.push('watchPosition'); window.reportFixtureGeolocation('watchPosition'); return 1; }, clearWatch() {},
      } });
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      blockedRequests.push(url.href); return route.abort('blockedbyclient');
    });
    const openPage = async (viewport) => {
      // Independent scenarios get a fresh document/page. Browser Back/Forward
      // assertions below deliberately stay within the same page. Reusing a
      // Independent pages also prevent query and camera state leaking between scenarios.
      const previous = page;
      page = await context.newPage();
      await previous?.close();
      if (viewport) await page.setViewportSize(viewport);
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') browserConsole.push(message.text()); });
      page.on('requestfailed', request => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
      await page.goto(`${origin}/feed/events`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.getByRole('heading', { name: 'Events', exact: true }).waitFor();
    };
    const toggle = () => page.getByRole('button', { name: 'Show events map', exact: true });
    const search = () => page.getByPlaceholder('Search events, venues, hosts…');
    const frame = () => page.getByTestId('unified-map');
    const markers = () => page.locator('[data-map-marker]');
    const venues = () => page.locator('button[data-event-id]');
    const waitVenues = count => page.waitForFunction(n => document.querySelectorAll('button[data-event-id]').length === n, count);
    const src = () => page.evaluate(()=>{const p=window.mapFixture.mapFocus;return p ? `${p.lat},${p.lng}` : null;});
    const select = title => page.getByRole('button', { name: title, exact: true });
    const fit = async label => {
      const result = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        // The production tabs intentionally scroll horizontally on narrow
        // screens; other controls must remain inside the viewport.
        const nodes = [...document.querySelectorAll('input,button,iframe')].filter(el => !el.closest('.overflow-x-auto'));
        return { width: w, scrollWidth: document.documentElement.scrollWidth, controls: nodes.filter(el => {
          const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > w + 1);
        }).map(el => ({ label: el.getAttribute('aria-label') || el.textContent, rect: el.getBoundingClientRect().toJSON() })) };
      });
      assert.ok(result.scrollWidth <= result.width + 1, `${label}: horizontal document overflow ${JSON.stringify(result)}`);
      assert.deepEqual(result.controls, [], `${label}: offscreen controls`);
      assert.ok(await search().evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 16, 'search must not trigger mobile focus zoom');
    };
    await openPage();
    assert.equal(await toggle().getAttribute('aria-pressed'), 'false');
    assert.equal(providerMarkers.length, 0, 'closed map must not contact a provider');
    await toggle().click();
    await page.getByRole('heading', { name: 'Events map', exact: true }).waitFor();
    await waitVenues(4);
    assert.equal(await toggle().getAttribute('aria-pressed'), 'true');
    assert.equal(await frame().count(), 1, 'exactly one unified map is rendered');
    assert.equal(await src(), '39.5,-98.35', 'without viewer location do not imply first event is nearby');
    assert.equal(await markers().count(),4,'all four authorized event markers share one surface');
    assert.equal(await page.getByRole('group',{name:'Map mode'}).count(),0,'no separate events/people mode');
    assert.deepEqual(await venues().allTextContents(), ['Harbor Lights', 'Mission Night', 'Harbor Afterparty', 'Equator Zero']);
    for (const e of all.filter(e => Number(e.id) >= 200 && Number(e.id) < 300)) {
      assert.equal(await page.getByText(e.title, { exact: true }).count(), 0, `${e.title} must not leak through map selectors or previews`);
    }
    check('unified map excludes hidden/private/unpublished/invalid/online/unverified rows');

    await select('Mission Night').click();
    assert.equal(await src(), '37.7599,-122.4148');
    await page.getByRole('button', { name: 'View event', exact: true }).click();
    await page.getByRole('heading', { name: 'Event route fixture' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/feed/events/102');
    await page.goBack(); await waitVenues(4);
    assert.equal(await toggle().getAttribute('aria-pressed'), 'true');
    await page.goForward(); await page.getByRole('heading', { name: 'Event route fixture' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/feed/events/102');
    await page.goBack(); await waitVenues(4);
    check('venue selection updates provider camera; authenticated stable id member route and browser Back/Forward');

    await search().fill('Harbor'); await waitVenues(2);
    await select('Harbor Afterparty').click();
    const sameLocation = await src();
    await select('Harbor Lights').focus(); await page.keyboard.press('Enter');
    assert.equal(await select('Harbor Lights').getAttribute('aria-pressed'), 'true');
    assert.equal(await src(), sameLocation, 'same coordinates remain the same place, but selected event id changes');
    await page.getByRole('button', { name: 'View event', exact: true }).click();
    await page.getByRole('heading', { name: 'Event route fixture' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/feed/events/101');
    await page.goBack(); await waitVenues(2);
    assert.equal(await search().inputValue(), 'Harbor');
    await select('Harbor Afterparty').focus(); await page.keyboard.press('Space');
    assert.equal(await select('Harbor Afterparty').getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'View event', exact: true }).click();
    await page.getByRole('heading', { name: 'Event route fixture' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/feed/events/103');
    await page.goBack(); await waitVenues(2);
    check('keyboard selectors, coincident venues retain distinct event IDs, search survives navigation');

    for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await fit(`${viewport.width}px map`);
      const geometry = await frame().evaluate(el => ({ frameWidth: el.getBoundingClientRect().width, containerWidth: el.parentElement.getBoundingClientRect().width }));
      assert.ok(Math.abs(geometry.frameWidth - geometry.containerWidth) <= 1, 'unified map fills its real map container');
      assert.ok(geometry.frameWidth > 200, 'unified map cannot collapse into a narrow strip');
      viewportEvidence.push({ viewport, ...geometry });
      await page.screenshot({ path: path.join(dir, `map-${viewport.width}.png`), fullPage: true });
    }
    check('320/393/768/1440px real CSS, shrinking search, 16px input and screenshots');
    await page.setViewportSize({ width: 393, height: 852 });
    await page.getByRole('button', { name: 'Show event list', exact: true }).click();
    await frame().waitFor({ state: 'detached' });
    assert.equal(await toggle().getAttribute('aria-pressed'), 'false');
    assert.equal(await toggle().evaluate(el => document.activeElement === el), true, 'closing map restores toggle focus');
    assert.equal(await search().inputValue(), 'Harbor');
    assert.ok((await page.locator('[role="button"]').allTextContents()).some(t => t.includes('Harbor Lights')), 'same search remains visible in real list');
    await toggle().click(); await waitVenues(2);
    await page.keyboard.press('Escape'); await frame().waitFor({ state: 'detached' });
    assert.equal(await toggle().evaluate(el => document.activeElement === el), true, 'Escape restores toggle focus');
    await toggle().click(); await waitVenues(2);
    check('close/reopen/Escape and same filtered list, with focus restoration');

    await search().fill(''); await waitVenues(4);
    await select('Equator Zero').click();
    assert.equal(await src(), '0,0');
    await page.getByRole('button', { name: 'For You', exact: true }).click();
    await page.locator('button[data-event-id="501"]').waitFor(); await waitVenues(1);
    assert.equal(await venues().first().textContent(), 'Personalized Night');
    await page.getByRole('button', { name: 'Past', exact: true }).click();
    await page.locator('button[data-event-id="401"]').waitFor(); await waitVenues(1);
    assert.equal(await venues().first().textContent(), 'Past Archive');
    await page.getByRole('button', { name: 'All', exact: true }).click(); await waitVenues(4);
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click(); await waitVenues(4);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByRole('button', { name: 'Online', exact: true }).click();
    await page.getByRole('button', { name: 'Close filters', exact: true }).click();
    await page.getByText('No published map locations for these results.', { exact: true }).waitFor();
    assert.equal(await markers().count(), 0);
    check('zero coordinates, Upcoming/For You/All/Past tabs and Online filter share real list state');

    for (const ids of [['201', '202', '203', '204', '205', '206', '207'], ['301'], ['302', '303']]) {
      await openPage();
      await page.evaluate(ids => { const f = window.mapFixture; f.setData({ all: f.data.all.filter(e => ids.includes(e.id)) }); }, ids);
      const before = providerMarkers.length;
      await toggle().click();
      await page.getByText('No published map locations for these results.', { exact: true }).waitFor();
      assert.equal(await venues().count(), 0);
      assert.equal(await markers().count(), 0, 'no eligible coordinates may become provider markers');
      assert.equal(providerMarkers.length, before, 'private/online/invalid-only data must not reach third-party provider');
    }
    check('private-only, online-only, invalid/missing-coordinate states make zero provider coordinate submissions');

    for (const patch of [{ visibility: 'private' }, { isHidden: true }, { publishAt: '2099-12-31T23:59:59Z' }, { status: 'cancelled' }, { isOnline: true }]) {
      await openPage();
      await toggle().click(); await waitVenues(4);
      await select('Mission Night').click();
      await page.evaluate(patch => { const f = window.mapFixture; f.data = { ...f.data, all: f.data.all.map(e => e.id === '102' ? {...e, ...patch} : e) }; dispatchEvent(new Event('fixturechange')); }, patch);
      await waitVenues(3);
      assert.notEqual(await src(), '37.7599,-122.4148');
      assert.equal(await select('Mission Night').count(), 0, 'restrictive realtime patch removes previously selected venue: ' + JSON.stringify(patch));
    }
    check('restrictive realtime visibility/hidden/publication/status/online patches remove old selection');

    await openPage();
    await page.evaluate(() => { window.mapFixture.locationError = true; });
    const beforeLocationFailure = providerMarkers.length;
    await toggle().click();
    await page.getByRole('button', { name: 'Retry locations', exact: true }).waitFor();
    assert.equal(await markers().count(), 0);
    assert.equal(providerMarkers.length, beforeLocationFailure, 'metadata failure cannot provide event coordinates to SDK');
    await page.waitForFunction(()=>window.mapFixture.mapZoom===3);
    await page.evaluate(() => { window.mapFixture.locationError = false; });
    await page.getByRole('button', { name: 'Retry locations', exact: true }).click(); await waitVenues(4);
    assert.equal(await page.evaluate(()=>window.mapFixture.mapZoom),3,'late event metadata must not pretend to locate the viewer');
    await select('Mission Night').click();
    await page.waitForFunction(()=>window.mapFixture.mapZoom===12);
    await page.evaluate(() => { const f = window.mapFixture; f.locationError = true; void f.queryClient.invalidateQueries({ queryKey: ['events-map'] }); });
    await page.getByRole('button', { name: 'Retry locations', exact: true }).waitFor();
    assert.equal(await venues().count(), 0);
    assert.equal(await markers().count(), 0, 'failed fresh authorization lookup cannot retain cached venue');
    check('metadata lookup retries and failed refresh removes stale coordinates');

    await openPage();
    await page.evaluate(()=>{window.mapFixture.providerStatus='auth_failure';dispatchEvent(new Event('fixturechange'));});
    await toggle().click();await waitVenues(4);
    await page.getByText('Google Maps could not load.',{exact:false}).waitFor();
    assert.equal(await frame().count(),0,'provider failure cannot render map');
    assert.equal(await page.getByRole('switch',{name:'Show my avatar on Events map'}).isDisabled(),true);
    await page.evaluate(()=>{window.mapFixture.providerStatus='loaded';dispatchEvent(new Event('fixturechange'));});
    await frame().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-map-marker]').length === 4);
    assert.equal(await markers().count(),4);
    await page.getByRole('button', { name: 'Show event list', exact: true }).click();await frame().waitFor({state:'detached'});
    check('provider auth failure hides map and disables new sharing; recovery preserves event markers');

    await page.evaluate(() => window.mapFixture.setAuthenticated(false));
    await toggle().click(); await waitVenues(4);
    assert.equal(await page.getByRole('button', { name: 'Toggle spicy events' }).count(), 0);
    await select('Mission Night').click();
    await page.getByRole('button', { name: 'View event', exact: true }).click();
    await page.getByRole('heading', { name: 'Event route fixture' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/public/events/102', 'guests use the public stable-id event route');
    await page.goBack(); await waitVenues(4);
    assert.equal(await toggle().getAttribute('aria-pressed'), 'true', 'guest Back returns to the open map');
    assert.equal(await select('Mission Night').getAttribute('aria-pressed'), 'true', 'guest Back preserves the selected event');
    assert.equal(await src(), '39.5,-98.35','reopening map defaults to viewer area or broad overview, not persisted event focus');
    check('guest View event uses public stable-id route and Back restores the selected venue');
    assert.equal(await page.locator('iframe').count(),0,'unified map does not add hidden iframe providers');
    assert.deepEqual(await page.evaluate(() => window.geolocationCalls), []);
    assert.deepEqual(geolocationCalls, [], 'no scenario may request device location');
    for (const marker of providerMarkers) {
      assert.equal(['-33.9,151.2', '-34.6,-58.4', '51.5,0.1'].includes(`${marker.lat},${marker.lng}`),false,'private coordinates never enter SDK markers');
    }
    // Independent fixed-device captures verify the unified map's actual container geometry.
    for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await openPage(viewport);
      await search().fill('Harbor'); await toggle().click(); await waitVenues(2);
      await select('Harbor Afterparty').click(); await fit(`${viewport.width}px fixed map`);
      await frame().scrollIntoViewIfNeeded();
      const geometry = async () => frame().evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, containerWidth: el.parentElement.getBoundingClientRect().width }));
      const before = await geometry();
      assert.ok(Math.abs(before.width-before.containerWidth)<=1);
      await page.screenshot({ path: path.join(dir, `fixed-${viewport.width}-viewport.png`) });
      await frame().screenshot({ path: path.join(dir, `fixed-${viewport.width}-map.png`) });
      await page.screenshot({ path: path.join(dir, `fixed-${viewport.width}-fullpage.png`), fullPage: true });
      fixedViewportEvidence.push({ viewport, before, after: await geometry() });
    }
    check('fresh fixed-viewport geometry and separate viewport/map/full-page capture evidence');

    // A capped flex-column list must scroll, not shrink multi-line selector
    // buttons until their titles overflow into adjacent event targets.
    for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await openPage(viewport);
      await page.evaluate(data => window.mapFixture.setData(data), { all: crowded, locations: crowded.map(rawLocation) });
      await toggle().click(); await waitVenues(crowded.length);
      await fit(`${viewport.width}px crowded map selectors`);
      const selectorList = page.locator('[aria-label="Events with map locations"]');
      const geometry = await selectorList.evaluate(el => ({
        height: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: getComputedStyle(el).overflowY,
        buttons: [...el.querySelectorAll('button[data-event-id]')].map(button => {
          const range = document.createRange(); range.selectNodeContents(button);
          return { id: button.dataset.eventId, height: button.getBoundingClientRect().height,
            clientHeight: button.clientHeight, scrollHeight: button.scrollHeight,
            textLines: range.getClientRects().length };
        }),
      }));
      assert.equal(geometry.overflowY, 'auto', 'crowded venue selectors must remain scrollable');
      assert.ok(geometry.height <= 257 && geometry.scrollHeight > geometry.height, 'eight selectors must overflow the capped list, not compress to fit');
      assert.equal(geometry.buttons.length, 8);
      for (const button of geometry.buttons) {
        assert.ok(button.height >= 44, `selector ${button.id} retains its minimum touch target`);
        assert.ok(button.scrollHeight <= button.clientHeight + 1, `selector ${button.id} must contain its full title: ${JSON.stringify(button)}`);
      }
      assert.ok(geometry.buttons[0].textLines >= 2 && geometry.buttons[0].height > 44, 'long title must wrap onto multiple lines without shrinking its button');
      await select(crowded.at(-1).title).focus(); await page.keyboard.press('Space');
      assert.equal(await select(crowded.at(-1).title).getAttribute('aria-pressed'), 'true', 'last overflowing selector stays keyboard-accessible');
      await select(longTitle).focus(); await page.keyboard.press('Enter');
      assert.equal(await select(longTitle).getAttribute('aria-pressed'), 'true', 'multi-line selector remains independently selectable');
      await selectorList.evaluate(el => { el.scrollTop = 0; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await selectorList.screenshot({ path: path.join(dir, `long-title-selectors-${viewport.width}.png`) });
      longTitleEvidence.push({ viewport, ...geometry });
    }
    check('eight-row scroll list preserves multi-line selector height and keyboard selection at all four widths');
    assert.deepEqual(blockedRequests, [], 'unexpected network boundary request');
    assert.deepEqual(errors, [], 'browser uncaught errors');
    check('guest mode, zero geolocation calls and no private location in any provider marker');
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({
      status: 'passed', commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      browser: engine.name(), checks, viewportEvidence, fixedViewportEvidence, longTitleEvidence, providerMarkers: providerMarkers.length, errors, blockedRequests,
      scope: 'Actual production EventsListScreen, unified EventsMap/MemberMap, Zustand, React Query and CSS; synthetic data/auth/router and Google SDK/member hook boundaries. API contract uses real source with mocked Supabase transport. Does not prove live provider, deployed route, database access rules or physical mobile behavior.',
    }, null, 2));
    console.log('PASS web Events map browser regressions. Evidence:', dir);
  } catch (error) {
    console.error('Browser errors:', JSON.stringify(errors));
    console.error('Browser console:', JSON.stringify(browserConsole));
    console.error('Failed requests:', JSON.stringify(failedRequests));
    console.error('Blocked requests:', JSON.stringify(blockedRequests));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ status: 'failed', checks, error: String(error), errors, browserConsole, failedRequests, blockedRequests }, null, 2));
    if (page) {
      console.error('Failure page URL:', page.url());
      console.error('Failure page HTML:', (await page.content().catch(() => '')).slice(0, 3000));
      console.error('Failure page:', await page.locator('body').innerText().catch(() => ''));
      await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: true }).catch(() => {});
    }
    throw error;
  } finally {
    await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
