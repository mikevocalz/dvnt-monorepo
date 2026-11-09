'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');
const { resolveWebBackend, resolveNextWebBackend } = require('../packages/supabase/src/web-backend.cjs');
const PROD = 'https://npfjanxturvmjyevoyfo.supabase.co';
const STAGE = 'https://preview.supabase.co';
const KEY = 'sb_publishable_fixture';
const jwt = claims => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;

function loadConfig(env) {
  const filename = path.resolve(__dirname, '../apps/web/next.config.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, reportDiagnostics: true });
  assert.equal(result.diagnostics.length, 0);
  const localRequire = createRequire(filename);
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, process: { env: { ...env } }, __dirname: path.dirname(filename), require: id => {
    if (id === '@payloadcms/next/withPayload') return { withPayload: config => config };
    if (id === '@sentry/nextjs') return { withSentryConfig: config => config };
    return localRequire(id);
  } }, { filename });
  return exports.default;
}

test('existing unconfigured production defaults stay paired', () => {
  const config = resolveNextWebBackend({});
  assert.equal(config.supabaseUrl, PROD);
  assert.equal(config.authUrl, `${PROD}/functions/v1/auth`);
  assert.equal(JSON.parse(Buffer.from(config.supabaseAnonKey.split('.')[1], 'base64url')).ref, 'npfjanxturvmjyevoyfo');
});
test('Next overrides Expo; Expo-only overrides work; origins normalize once', () => {
  const config = resolveNextWebBackend({ NEXT_PUBLIC_SUPABASE_URL: `${STAGE}/`, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY, EXPO_PUBLIC_SUPABASE_URL: PROD, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'invalid' });
  assert.equal(config.supabaseUrl, STAGE);
  assert.equal(config.authUrl, `${STAGE}/functions/v1/auth`);
  assert.equal(config.supabaseAnonKey, KEY);
  assert.deepEqual(resolveNextWebBackend({ EXPO_PUBLIC_SUPABASE_URL: STAGE, EXPO_PUBLIC_SUPABASE_ANON_KEY: KEY }), config);
});
for (const url of ['', ' ', 'bad', 'http://preview.supabase.co', `${STAGE}/path`, `${STAGE}?q=1`, `${STAGE}#hash`, 'https://user:password@preview.supabase.co']) {
  test(`explicit invalid URL fails closed: ${url}`, () => assert.throws(() => resolveNextWebBackend({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY }), /Supabase URL/));
}
test('alternate backend cannot borrow production fallback key', () => {
  assert.throws(() => resolveWebBackend(STAGE), /requires its own/);
  assert.throws(() => resolveWebBackend(STAGE, resolveWebBackend().supabaseAnonKey), /different project/);
});
for (const key of ['', ' ', 'eyJgarbage', 'sb_secret_fixture', jwt({ role: 'service_role', ref: 'preview' })]) {
  test('invalid or privileged explicit key fails closed', () => assert.throws(() => resolveWebBackend(STAGE, key), /key/i));
}
test('legacy project-bound anon JWT and local backend are supported', () => {
  assert.equal(resolveWebBackend(STAGE, jwt({ role: 'anon', ref: 'preview' })).supabaseUrl, STAGE);
  assert.equal(resolveWebBackend('http://127.0.0.1:54321/', KEY).supabaseUrl, 'http://127.0.0.1:54321');
});
test('auth override cannot silently mix production and staging', () => {
  for (const auth of ['', `${PROD}/functions/v1/auth`, `${STAGE}/functions/v1/auth?x=1`]) {
    assert.throws(() => resolveNextWebBackend({ NEXT_PUBLIC_SUPABASE_URL: STAGE, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY, EXPO_PUBLIC_AUTH_URL: auth }), /Auth URL/);
  }
  assert.throws(() => resolveNextWebBackend({ EXPO_PUBLIC_AUTH_URL: `${STAGE}/functions/v1/auth` }), /Auth URL/);
});
test('real Next config imports and binds browser, SSR auth and both rewrites', async () => {
  for (const prefix of ['NEXT_PUBLIC', 'EXPO_PUBLIC']) {
    const config = loadConfig({ [`${prefix}_SUPABASE_URL`]: STAGE, [`${prefix}_SUPABASE_ANON_KEY`]: KEY });
    assert.equal(config.env.NEXT_PUBLIC_SUPABASE_URL, STAGE);
    assert.equal(config.env.EXPO_PUBLIC_SUPABASE_URL, STAGE);
    assert.equal(config.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, KEY);
    assert.equal(config.env.EXPO_PUBLIC_AUTH_URL, `${STAGE}/functions/v1/auth`);
    assert.equal(config.env.EXPO_PUBLIC_AUTH_SAME_ORIGIN, 'true');
    const rewrites = await config.rewrites();
    assert.equal(rewrites.find(rule => rule.source === '/api/auth/:path*').destination, `${STAGE}/functions/v1/auth/api/auth/:path*`);
    assert.equal(rewrites.find(rule => rule.source === '/api/fn/:path*').destination, `${STAGE}/functions/v1/:path*`);
  }
  assert.throws(() => loadConfig({ NEXT_PUBLIC_SUPABASE_URL: '' }), /Supabase URL/);
});
test('webpack definitions use the same resolved values, never conflicting raw Expo overrides', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../apps/web/next.config.ts'), 'utf8');
  for (const [key, value] of [['SUPABASE_URL', 'supabaseUrl'], ['SUPABASE_ANON_KEY', 'supabaseAnonKey'], ['AUTH_URL', 'authUrl']]) {
    assert.match(source, new RegExp(`'process\\.env\\.EXPO_PUBLIC_${key}': JSON\\.stringify\\(\\s*webBackend\\.${value},?\\s*\\)`));
  }
});

test('real browser client keeps direct data/uploads and proxied functions on configured backend', async () => {
  const esbuild = require('esbuild');
  const filename = path.resolve(__dirname, '../packages/supabase/src/client.web.ts');
  for (const prefix of ['NEXT_PUBLIC', 'EXPO_PUBLIC', 'VITE']) {
    const env = { EXPO_PUBLIC_AUTH_SAME_ORIGIN: 'true' };
    const vite = {};
    const target = prefix === 'VITE' ? vite : env;
    target[`${prefix}_SUPABASE_URL`] = `${STAGE}/`;
    target[`${prefix}_SUPABASE_ANON_KEY`] = KEY;
    const output = await esbuild.build({ entryPoints: [filename], bundle: true, write: false, format: 'cjs', platform: 'browser', logLevel: 'silent', define: { 'process.env': JSON.stringify(env), 'import.meta.env': JSON.stringify(vite) }, plugins: [{ name: 'external-boundaries', setup(build) {
      build.onResolve({ filter: /^(@supabase\/supabase-js|\.\/function-observer|\.\/bridge-transport|\.\/realtime-auth)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === '@supabase/supabase-js'
        ? 'export const createClient = (url,key,options) => ({url,key,options});'
        : args.path === './function-observer' ? 'export const withFunctionObserver=f=>f; export const setFunctionResponseObserver=()=>{};'
        : args.path === './bridge-transport' ? 'export const createBridgeTransport=()=>({setToken(){},setMinter(){},requestEpoch(){},accessToken(){},guardFetch:f=>f});'
        : 'export const createRealtimeAuthController=()=>({updateAuth:async()=>{},ensureBridgeRealtimeAuth(){}});' }));
    } }] });
    const module = { exports: {} };
    const requests = [];
    vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, URL, Request, atob, console: { log(){} }, window: { location: { origin: 'https://preview.example.test' } }, fetch: async (url, options) => { requests.push({ url, options }); return {}; } });
    const { supabase } = module.exports;
    assert.equal(supabase.url, STAGE);
    assert.equal(supabase.key, KEY);
    await supabase.options.global.fetch(`${STAGE}/functions/v1/update-user`, { method: 'POST', body: '{}' });
    await supabase.options.global.fetch(`${STAGE}/functions/v1/media-upload`, { method: 'POST' });
    await supabase.options.global.fetch(`${STAGE}/rest/v1/posts`);
    assert.equal(requests[0].url, 'https://preview.example.test/api/fn/update-user');
    assert.equal(requests[0].options.body, '{}');
    assert.equal(requests[1].url, `${STAGE}/functions/v1/media-upload`);
    assert.equal(requests[2].url, `${STAGE}/rest/v1/posts`);
  }
});


test('explicit custom auth domains retain support without bypassing URL validation', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: STAGE, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY, EXPO_PUBLIC_AUTH_URL: 'https://auth.preview.example.test/auth/' };
  assert.equal(resolveNextWebBackend(env).authUrl, 'https://auth.preview.example.test/auth');
  assert.throws(() => resolveNextWebBackend({ ...env, EXPO_PUBLIC_AUTH_URL: 'http://auth.preview.example.test/auth' }), /Auth URL/);
});
