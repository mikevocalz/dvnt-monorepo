'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const STAGE = 'https://preview.supabase.co';
const KEY = 'sb_publishable_fixture';
const envFor = (url = STAGE) => ({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY });
const jwt = claims => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;

function loadRoute(relative, env, fetch = async () => { throw new Error('Unexpected fetch'); }) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, reportDiagnostics: true,
    });
    assert.equal(result.diagnostics.length, 0);
    const exports = {};
    cache.set(filename, exports);
    vm.runInNewContext(result.outputText, {
      exports, process: { env }, Response, URL, AbortSignal, fetch, Date,
      require: id => {
        if (id === 'next/server') return { NextResponse: Response };
        if (id === '@/lib/public-web-backend') return load(path.join(root, 'apps/web/src/lib/public-web-backend.ts'));
        if (id.endsWith('/web-backend.cjs')) return require(path.resolve(path.dirname(filename), id));
        throw new Error(`Unexpected import ${id}`);
      },
    }, { filename });
    return exports;
  }
  return load(path.join(root, relative));
}
const configRoute = 'apps/web/src/app/api/pwa/backend/route.ts';
const probeRoute = 'apps/web/src/app/api/observability/probes/route.ts';

test('PWA config exposes only the selected public pair, uses Next precedence, and is not cached', async () => {
  for (const prefix of ['NEXT_PUBLIC', 'EXPO_PUBLIC']) {
    const env = { [`${prefix}_SUPABASE_URL`]: `${STAGE}/`, [`${prefix}_SUPABASE_ANON_KEY`]: KEY,
      SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-returned', DATABASE_URI: 'must-not-be-returned' };
    if (prefix === 'NEXT_PUBLIC') Object.assign(env, { EXPO_PUBLIC_SUPABASE_URL: 'https://other.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'invalid' });
    const route = loadRoute(configRoute, env);
    const response = route.GET();
    assert.equal(route.dynamic, 'force-dynamic');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { supabaseUrl: STAGE, supabaseAnonKey: KEY });
  }
});

for (const env of [
  {}, { NEXT_PUBLIC_SUPABASE_URL: STAGE }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY },
  envFor(''), envFor('https://user:password@preview.supabase.co'),
  { ...envFor(), NEXT_PUBLIC_SUPABASE_ANON_KEY: '' },
  { ...envFor(), NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_fixture' },
  { ...envFor(), NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'service_role', ref: 'preview' }) },
  { ...envFor(), NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: 'other' }) },
]) {
  test('PWA config and health probes fail closed for absent, invalid, privileged or mismatched configuration', async () => {
    for (const filename of [configRoute, probeRoute]) {
      let calls = 0;
      const response = await loadRoute(filename, env, async () => { calls++; }).GET();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'Public web backend configuration is unavailable' });
      assert.equal(calls, 0);
    }
  });
}

test('health probes read only the configured backend and isolate cached results', async () => {
  const calls = [];
  const env = envFor();
  const route = loadRoute(probeRoute, env, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ ok: true });
  });
  assert.equal((await route.GET()).status, 200);
  await route.GET();
  assert.deepEqual(calls.map(call => call.url), [`${STAGE}/functions/v1/db-health`, `${STAGE}/functions/v1/cdn-probe`]);
  for (const { options } of calls) {
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
  }
  env.NEXT_PUBLIC_SUPABASE_URL = 'https://second.supabase.co';
  await route.GET();
  assert.equal(calls.length, 4);
  assert.match(calls[2].url, /^https:\/\/second\.supabase\.co\//);
});

function loadWorker(fetch) {
  const listeners = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/web/public/sw.js'), 'utf8'), {
    self: { addEventListener: (name, callback) => listeners.set(name, callback) },
    fetch, URL, AbortSignal,
  });
  return async signalId => {
    let pending;
    listeners.get('notificationclick')({
      action: 'decline', notification: { close() {}, data: { signalId } }, waitUntil: value => { pending = value; },
    });
    await pending;
  };
}

test('real service worker resolves its own deployment before declining a numeric or string signal', async () => {
  for (const signalId of [42, '42']) {
    const calls = [];
    const decline = loadWorker(async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? loadRoute(configRoute, envFor()).GET() : Response.json({});
    });
    await decline(signalId);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, '/api/pwa/backend');
    assert.equal(calls[0].options.cache, 'no-store');
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[1].url, `${STAGE}/rest/v1/call_signals?id=eq.42`);
    assert.equal(calls[1].options.method, 'PATCH');
    assert.equal(calls[1].options.redirect, 'error');
    assert.equal(calls[1].options.credentials, 'omit');
    assert.equal(calls[1].options.headers.apikey, KEY);
    assert.equal(calls[1].options.headers.Authorization, `Bearer ${KEY}`);
    assert.deepEqual(JSON.parse(calls[1].options.body), { status: 'declined' });
  }
});

test('service worker rejects malformed push IDs without any network request', async () => {
  let calls = 0;
  const decline = loadWorker(async () => { calls++; });
  for (const signalId of [null, undefined, {}, [], true, '', ' ', '0', '-1', '1.5', '1&id=gt.0', '1&or=(id.gt.0)', '1#ignored', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await decline(signalId);
  assert.equal(calls, 0);
});

test('service worker makes no mutation when local configuration is missing, malformed, or unavailable', async () => {
  for (const firstResponse of [
    () => Response.json({}, { status: 503 }),
    () => { throw new Error('offline'); },
    () => new Response('invalid json'),
    ...[{}, null, { supabaseUrl: STAGE }, { supabaseUrl: STAGE, supabaseAnonKey: '' },
      { supabaseUrl: 'http://remote.example.test', supabaseAnonKey: KEY },
      { supabaseUrl: `${STAGE}/path`, supabaseAnonKey: KEY },
      { supabaseUrl: 'https://user:password@preview.supabase.co', supabaseAnonKey: KEY }].map(body => () => Response.json(body)),
  ]) {
    const calls = [];
    const decline = loadWorker(async url => { calls.push(url); return firstResponse(); });
    await decline(42);
    assert.deepEqual(calls, ['/api/pwa/backend']);
  }
});

function loadClickWorker(clients, fetch = () => assert.fail('Unexpected decline request')) {
  const listeners = new Map();
  const filename = path.join(root, 'apps/web/public/sw.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    self: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      clients,
      location: { href: 'https://dvnt.test/sw.js' },
    },
    fetch, URL, AbortSignal,
  }, { filename });
  return (data, action = '') => {
    let pending;
    let closed = false;
    listeners.get('notificationclick')({
      action, notification: { data, close() { closed = true; } },
      waitUntil(value) { pending = value; },
    });
    assert.equal(closed, true);
    assert.equal(typeof pending?.then, 'function');
    return pending;
  };
}

const activity = { type: 'staff_invite', url: '/feed/activity' };

test('staff notification waits for existing-window navigation and focuses the returned client', async () => {
  let finishNavigation;
  const actions = [];
  const navigation = new Promise(resolve => { finishNavigation = resolve; });
  const original = {
    url: 'https://dvnt.test/feed',
    navigate(target) { actions.push(['navigate', target]); return navigation; },
    focus() { actions.push(['focus', 'original']); return Promise.resolve(this); },
  };
  const destination = { focus() { actions.push(['focus', 'destination']); } };
  const click = loadClickWorker({
    matchAll: async options => {
      actions.push(['include uncontrolled', options.includeUncontrolled === true]);
      return [original];
    },
    openWindow: async () => assert.fail('A controlled window navigated successfully'),
  })(activity);
  let settled = false;
  click.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  const snapshot = [[...actions], settled];
  finishNavigation(destination);
  await click;
  assert.deepEqual(snapshot, [[['include uncontrolled', false], ['navigate', '/feed/activity']], false]);
  assert.deepEqual(actions.at(-1), ['focus', 'destination']);
});

test('staff notification falls back to opening Activity if navigation is rejected or returns null', async () => {
  for (const nav of [() => null, () => { throw new Error('Cannot navigate'); }]) {
    const calls = [];
    await loadClickWorker({
      matchAll: async () => [{
        url: 'https://dvnt.test/feed', navigate: nav,
        focus: async () => { calls.push('focused wrong page'); },
      }],
      openWindow: async url => { calls.push(url); },
    })(activity);
    assert.deepEqual(calls, ['/feed/activity']);
  }
});

test('notification focuses an existing Activity window without reloading or opening another', async () => {
  let focused = 0;
  await loadClickWorker({
    matchAll: async () => [{
      url: 'https://dvnt.test/feed/activity',
      navigate: () => assert.fail('Already at target'),
      focus: async () => { focused++; },
    }],
    openWindow: async () => assert.fail('Already at target'),
  })(activity);
  assert.equal(focused, 1);
});

test('cold staff click opens Activity; cold call accept still opens its call route', async () => {
  const opened = [];
  const click = loadClickWorker({
    matchAll: async () => [],
    openWindow: async url => { opened.push(url); },
  });
  await click(activity);
  await click({ type: 'call', roomId: 'room-3', url: '/elsewhere' }, 'accept');
  assert.deepEqual(opened, ['/feed/activity', '/feed/call/room-3']);
});
