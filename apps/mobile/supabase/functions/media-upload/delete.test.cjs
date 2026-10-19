// Synthetic handler tests only: no network, real credentials, or live deletes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(`${__dirname}/index.ts`, 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const own = 'post-image/fixture-owner/2026/10/fixture-original.jpg';
function setup({ userId = 'fixture-owner', expiresAt = '2099-01-01', status = 200, noSession = false, limited = false, throws = false } = {}) {
  const calls = [];
  let handler;
  const db = { from(table) { assert.equal(table, 'session'); return { select() { return this; }, eq(column, value) { assert.equal(column, 'token'); assert.equal(value, 'synthetic'); return this; }, async single() { return { data: noSession ? null : { userId, expiresAt }, error: null }; } }; } };
  const env = { SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', BUNNY_STORAGE_HOST: 'storage.invalid', BUNNY_STORAGE_ZONE: 'fixture-zone', BUNNY_ACCESS_KEY: 'synthetic', BUNNY_PULLZONE_BASE_URL: 'https://cdn.invalid' };
  new Function('exports', 'require', 'Deno', 'fetch', js)({}, name => {
    if (name.includes('supabase-js')) return { createClient: () => db };
    if (name === '../_shared/rate-limit.ts') return { checkRateLimit: () => ({ allowed: !limited }), UPLOAD_LIMIT: {} };
    throw Error(`Unexpected dependency ${name}`);
  }, { serve(fn) { handler = fn; }, env: { get: key => env[key] } }, async (url, init) => {
    calls.push({ url, init });
    if (throws) throw Error('synthetic network failure');
    return new Response(null, { status });
  });
  return { calls, async request(keys, auth = 'Bearer synthetic', raw) {
    const response = await handler(new Request('https://edge.invalid/media-upload', { method: 'DELETE', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify({ keys }) }));
    return response.json();
  } };
}
test('owner cleanup works for every current media kind; storage URL stays canonical', async () => {
  for (const kind of ['avatar', 'post-image', 'post-video', 'story-image', 'story-video', 'event-cover', 'event-image', 'event-moment-photo', 'event-moment-video', 'event-video', 'message-image', 'message-video']) {
    const s = setup(); const key = own.replace('post-image', kind);
    assert.deepEqual(await s.request([key]), { ok: true, results: [{ key, deleted: true }] });
    assert.equal(s.calls[0].url, `https://storage.invalid/fixture-zone/${key}`);
    assert.equal(s.calls[0].init.method, 'DELETE');
    assert.equal(s.calls[0].init.redirect, 'error');
    assert.ok(s.calls[0].init.signal instanceof AbortSignal);
  }
});
test('foreign owner and prefix ambiguities never reach storage', async () => {
  for (const owner of ['someone-else', 'fixture-owner-extra', 'fixture-own', 'FIXTURE-owner']) {
    const s = setup(); const key = own.replace('fixture-owner', owner);
    const result = await s.request([key]);
    assert.equal(result.results[0].deleted, false); assert.equal(s.calls.length, 0);
  }
});
test('noncanonical paths, URL syntax and encoded traversal never reach storage', async () => {
  for (const key of [
    '../other.jpg', `/${own}`, `https://cdn.invalid/${own}`, `https://evil.invalid/${own}`,
    own.replace('/2026/', '/./2026/'), own.replace('/2026/', '/%2e%2e/'), own.replace('/2026/', '/%252e%252e/'),
    own.replace('/2026/', '//2026/'), own.replace('/2026/', '\\2026/'), own + '?x=1', own + '#x', own + '\n',
    own.replace('fixture-owner', 'fixture-owner%2fother'), own.replace('post-image', 'unknown'),
    own.replace('/10/', '/00/'), own.replace('/10/', '/13/'), own.replace('fixture-original.jpg', '..'),
    own.replace('fixture-original.jpg', '%66ile.jpg'), 'post-image/fixture-owner', '',
  ]) {
    const s = setup(); const result = await s.request([key]);
    assert.equal(result.results[0].deleted, false, key); assert.equal(s.calls.length, 0, key);
  }
});
test('malformed input fails closed without throwing or deleting a valid prefix', async () => {
  for (const keys of [[own, null], [own, 1], [own, {}], [own, []], [], Array(51).fill(own), 'not-an-array']) {
    const s = setup(); assert.equal((await s.request(keys)).ok, false); assert.equal(s.calls.length, 0);
  }
  for (const raw of ['null', '{', '[]']) { const s = setup(); assert.equal((await s.request(undefined, undefined, raw)).ok, false); assert.equal(s.calls.length, 0); }
});
test('mixed batch cannot delete another owner, but preserves legitimate cleanup', async () => {
  const s = setup(); const foreign = own.replace('fixture-owner', 'someone-else');
  assert.deepEqual((await s.request([foreign, own])).results, [{ key: foreign, deleted: false }, { key: own, deleted: true }]);
  assert.equal(s.calls.length, 1);
});
test('missing, expired, malformed sessions and rate refusal cannot delete', async () => {
  for (const options of [{ noSession: true }, { expiresAt: '2000-01-01' }, { expiresAt: 'invalid' }, { expiresAt: null }, { expiresAt: new Date().toISOString() }, { userId: '' }, { userId: '../bad' }, { limited: true }]) {
    const s = setup(options); const result = await s.request([own]); assert.equal(result.ok, false); assert.equal(s.calls.length, 0);
  }
  const s = setup(); assert.equal((await s.request([own], '')).ok, false); assert.equal(s.calls.length, 0);
});
test('missing object is idempotent; storage failure is never success', async () => {
  for (const status of [200, 404, 403, 500]) { const s = setup({ status }); assert.equal((await s.request([own])).results[0].deleted, [200, 404].includes(status)); }
  const s = setup({ throws: true }); assert.equal((await s.request([own])).results[0].deleted, false);
});
