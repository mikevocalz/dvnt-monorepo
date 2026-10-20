#!/usr/bin/env node
// Execute the real browser upload client, real media-upload edge handler and
// real rate limiter. Only external session/media DB and Bunny storage are fake.
// Time advances through an injected sleep; no network, credentials or real wait.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { FunctionsClient } = require('@supabase/functions-js');
const root = path.resolve(__dirname, '..');

function load(file, adapters = {}, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', ...Object.keys(globals), source)(name => {
    assert.ok(Object.hasOwn(adapters, name), `Unexpected dependency ${name}`); return adapters[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}

function setup() {
  const state = { now: Date.parse('2026-01-01T00:00:00Z'), token: 'fixture-session', waits: [], messages: [], requests: 0, rows: [], puts: [], failVideoBytes: null, onWait: null };
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return state.now; }
  }
  const rate = load('apps/mobile/supabase/functions/_shared/rate-limit.ts', {}, { Date: FixtureDate });
  const { createWebUploadScheduler } = load('packages/app/lib/media/web-upload-rate.ts');
  const scheduleWebUpload = createWebUploadScheduler({ now: () => state.now, sleep: async ms => {
    state.waits.push(ms); await state.onWait?.(); state.now += ms;
  } });
  const admin = { from(table) {
    if (table === 'session') return { select() { return this; }, eq(column, value) { assert.equal(column, 'token'); assert.equal(value, 'fixture-session'); return this; }, async single() { return { data: { userId: 'fixture-owner', expiresAt: '2099-01-01' }, error: null }; } };
    if (table === 'live_photo_upload_receipts') return { async insert(receipt) { assert.equal(receipt.owner_auth_id, 'fixture-owner'); assert.ok(state.rows.some(row => row.filename === receipt.object_key && row.url === receipt.url)); return { error: null }; } };
    assert.equal(table, 'media');
    return { insert(record) { state.rows.push(record); return { select() { return this; }, async single() { return { data: { id: state.rows.length, ...record }, error: null }; } }; } };
  } };
  const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-value', BUNNY_STORAGE_HOST: 'storage.fixture.invalid', BUNNY_STORAGE_ZONE: 'fixture-zone', BUNNY_ACCESS_KEY: 'fixture-value', BUNNY_PULLZONE_BASE_URL: 'https://cdn.fixture.invalid' };
  let handler;
  load('apps/mobile/supabase/functions/media-upload/index.ts', {
    'https://esm.sh/@supabase/supabase-js@2': { createClient: () => admin }, '../_shared/rate-limit.ts': rate,
  }, { Date: FixtureDate, Deno: { serve: fn => { handler = fn; }, env: { get: name => env[name] } }, fetch: async (url, init) => {
    assert.equal(new URL(url).hostname, 'storage.fixture.invalid'); assert.equal(init.method, 'PUT');
    const bytes = Buffer.from(init.body), mime = init.headers['Content-Type'];
    state.puts.push({ url, bytes, mime });
    if (mime.startsWith('video/') && state.failVideoBytes?.equals(bytes)) return new Response('Synthetic storage refusal', { status: 400 });
    return new Response(null, { status: 201 });
  } });
  const functions = new FunctionsClient('https://fixture.invalid/functions/v1', { customFetch: async (url, init) => {
    assert.equal(new URL(url).pathname, '/functions/v1/media-upload'); state.requests++;
    const request = new Request(url, init);
    // Parse the real encoded multipart, not a direct File/JSON test adapter.
    return handler(new Request(url, { method: request.method, headers: request.headers, body: await request.arrayBuffer() }));
  } });
  const { uploadToServer } = load('packages/app/lib/server-upload.ts', {
    'expo-file-system/legacy': {}, 'react-native': { Platform: { OS: 'web' } },
    '@dvnt/app/lib/auth-client': { getAuthToken: async () => state.token },
    '@dvnt/app/lib/supabase/client': { supabase: { functions } },
    '@dvnt/app/lib/media/upload-watchdog-store': { beginUpload: () => 1, settleUpload: () => {} },
    '@dvnt/app/lib/media/upload-policy': load('packages/app/lib/media/upload-policy.ts'),
    '@dvnt/app/lib/media/browser-file-mime': load('packages/app/lib/media/browser-file-mime.ts'),
    '@dvnt/app/lib/media/web-upload-rate': { scheduleWebUpload },
  });
  return { state, uploadToServer };
}

(async () => {
  const { state, uploadToServer } = setup();
  const { uploadLivePhotoPair } = load('packages/app/lib/media/live-photo-upload.ts');
  const { createPublishTask } = load('packages/app/lib/posts/publish-task.ts', { './post-caption.ts': load('packages/app/lib/posts/post-caption.ts') });
  const urls = [], originals = [], files = [];
  try {
    for (let index = 0; index < 10; index++) {
      const still = Buffer.from([0, 1, index, 0xff]), motion = Buffer.from([0, 9, index, 0xfe]);
      const uri = URL.createObjectURL(new Blob([still], { type: 'image/heic' }));
      const pairedVideoUri = URL.createObjectURL(new Blob([motion], { type: 'video/quicktime' }));
      urls.push(uri, pairedVideoUri); originals.push({ still, motion });
      files.push({ uri, pairedVideoUri, type: 'image', kind: 'livePhoto', mimeType: 'image/heic' });
    }
    const published = [];
    let descriptor;
    const prepare = (selected, operationId) => { descriptor = { operationId, postKind: 'media', content: '', slides: [], textTheme: 'graphite', location: '', isNSFW: false, files: selected, placedTags: [], uploaded: selected.map(() => null) }; };
    const run = () => createPublishTask(descriptor, 'fixture-owner', {
      currentOwnerId: () => 'fixture-owner', persistMedia: async file => file,
      uploadMedia: async (selected, report) => {
        const results = [];
        for (const file of selected) {
          const result = await uploadLivePhotoPair(file, uri => uploadToServer(uri, 'posts', undefined, { onStatus: report }));
          results.push(result.success ? { type: result.type, url: result.url, mimeType: result.mimeType, livePhotoVideoUrl: result.livePhotoVideoUrl } : { error: result.error });
        }
        return results;
      },
      createPost: async input => { published.push(input); return { id: published.length }; }, addPlacedTags() {},
    })(message => state.messages.push(message), saved => { descriptor = saved; });

    prepare(files, 'fixture-ten-pairs');
    state.onWait = () => assert.equal(published.length, 0, 'rate-limited array cannot publish its completed subset');
    await run();
    assert.deepEqual(state.waits, [60_000]); assert.equal(state.requests, 21);
    assert.equal(published.length, 1); assert.equal(published[0].media.length, 10);
    assert.equal(state.rows.length, 20);
    assert.ok(state.messages.some(message => message.includes('60 seconds')), 'actual uploader status reaches publish task progress');
    for (let index = 0; index < 10; index++) {
      const medium = published[0].media[index];
      assert.equal(medium.mimeType, 'image/heic'); assert.match(medium.url, /\.heic$/); assert.match(medium.livePhotoVideoUrl, /\.mov$/);
      assert.deepEqual(state.puts[index * 2].bytes, originals[index].still);
      assert.deepEqual(state.puts[index * 2 + 1].bytes, originals[index].motion);
      assert.equal(state.rows[index * 2 + 1].mime_type, 'video/quicktime');
    }

    // One failed motion among three pairs: complete pairs survive and only the
    // failed pair retries. This uses eight requests total, not twelve.
    state.now += 60_000; state.onWait = null;
    const before = state.requests, waits = state.waits.length;
    state.failVideoBytes = originals[1].motion;
    prepare(files.slice(0, 3), 'fixture-partial-retry');
    await assert.rejects(run(), /Synthetic storage refusal/);
    assert.equal(published.length, 1);
    assert.deepEqual(descriptor.uploaded.map(Boolean), [true, false, true]);
    assert.equal(state.requests - before, 6, 'generic storage failure is not retried by rate scheduler');
    state.failVideoBytes = null; await run();
    assert.equal(state.requests - before, 8); assert.equal(state.waits.length, waits);
    assert.equal(published.length, 2); assert.equal(published[1].media.length, 3);
    assert.ok(published[1].media.every(m => m.livePhotoVideoUrl));

    // A logout/account switch during the wait prevents replay under either
    // the old or the newly signed-in account; no token substitution occurs.
    state.now += 60_000;
    for (let index = 0; index < 10; index++) assert.equal((await uploadToServer(files[0].uri, 'posts')).success, true);
    state.onWait = () => { state.token = 'different-session'; };
    const requestCount = state.requests;
    const changed = await uploadToServer(files[0].uri, 'posts');
    assert.equal(changed.success, false); assert.match(changed.error, /sign-in changed/);
    assert.equal(state.requests, requestCount + 1, 'rate refusal occurs once; account change blocks actual retry');
    const beforeNextFile = state.requests;
    const nextFile = await uploadToServer(files[1].uri, 'posts', undefined, { expectedAuthToken: 'fixture-session' });
    assert.equal(nextFile.success, false); assert.match(nextFile.error, /sign-in changed/);
    assert.equal(state.requests, beforeNextFile, 'next half/file cannot capture another account after batch started');
    console.log('PASS actual media-upload handler + real 10/min limiter: ten original pairs complete after one bounded cooldown; status reaches publish progress; failed motion never flattens, successful pairs survive retry, unknown storage errors never auto-retry, and account switch blocks replay. External identity/media DB and Bunny storage are isolated test adapters; no production requests.');
  } finally { urls.forEach(url => URL.revokeObjectURL(url)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
