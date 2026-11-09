const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function moduleAt(file, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), ...globals });
  return module.exports;
}

test('actual metadata uses only uncached public-safe projection and fails closed without it', async () => {
  for (const value of [null, [], { content: 'untrusted raw caption', media: [{ url: 'https://private.invalid' }] }, { image: 'javascript:bad' }]) {
    const calls = [];
    const loaded = moduleAt('apps/web/src/app/(frontend)/feed/[username]/post/[id]/page.tsx', {
      process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'fixture' } },
      fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => value }; },
    });
    const metadata = await loaded.generateMetadata({ params: Promise.resolve({ username: 'author', id: '11' }) });
    assert.equal(metadata.description, 'connect. gather. move.');
    assert.equal(metadata.openGraph.images, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://fixture.invalid/rest/v1/rpc/public_post_share_preview');
    assert.equal(calls[0].options.cache, 'no-store');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), { p_post_id: '11' });
  }
  const safe = moduleAt('apps/web/src/app/(frontend)/feed/[username]/post/[id]/page.tsx', {
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'fixture' } },
    fetch: async () => ({ ok: true, json: async () => ({ description: 'safe public caption', image: 'https://fixture.invalid/safe.jpg' }) }),
  });
  const metadata = await safe.generateMetadata({ params: Promise.resolve({ username: 'author', id: '12' }) });
  assert.equal(metadata.description, 'safe public caption');
  assert.equal(metadata.openGraph.images[0].url, 'https://fixture.invalid/safe.jpg');
  for (const fetcher of [async () => ({ ok: false }), async () => { throw Error('offline'); }]) {
    const failed = moduleAt('apps/web/src/app/(frontend)/feed/[username]/post/[id]/page.tsx', {
      process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'fixture' } }, fetch: fetcher,
    });
    assert.equal((await failed.generateMetadata({ params: Promise.resolve({ username: 'author', id: '11' }) })).description, 'connect. gather. move.');
  }
});

test('short post link reaches authorized detail without anonymous content or author lookup', async () => {
  for (const [id, target] of [['11', '/feed/post/11'], ['0', '/feed'], ['invalid', '/feed']]) {
    const loaded = moduleAt('apps/web/src/app/(frontend)/p/[id]/page.tsx', {
      require: name => name === 'next/navigation' ? { redirect: to => { throw { to }; } } : {},
      fetch: () => { throw Error('Must not fetch protected data'); },
    });
    await assert.rejects(loaded.default({ params: Promise.resolve({ id }) }), error => error.to === target);
  }
});
