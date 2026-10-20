#!/usr/bin/env node
// Same production draft store, web branding and unchanged native theme semantics.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const paths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const { build } = require(require.resolve('esbuild', { paths: paths.length ? paths : undefined }));
(async () => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-draft-platform-'));
  try {
    for (const platform of ['web', 'ios', 'android']) {
      const file = path.join(dir, platform + '.cjs');
      await build({
        entryPoints: [path.join(root, 'packages/app/lib/stores/create-post-store.ts')], bundle: true,
        platform: 'node', format: 'cjs', outfile: file, tsconfigRaw: {}, nodePaths: paths,
        alias: { '@dvnt/app': path.join(root, 'packages/app') },
        plugins: [{ name: 'platform-storage', setup(b) {
          b.onResolve({ filter: /^(?:react-native|@dvnt\/app\/lib\/utils\/storage)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents:
            a.path === 'react-native' ? `export const Platform={OS:${JSON.stringify(platform)}};` :
            `const values=new Map();export const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};export const registerUserDataReset=()=>{};`
          }));
        }}],
      });
      const store = require(file).useCreatePostStore;
      assert.equal(store.getState().textTheme, platform === 'web' ? 'deviant' : 'graphite');
      store.getState().setTextTheme('cobalt');
      store.getState().setPostKind('text');
      assert.equal(store.getState().textTheme, platform === 'web' ? 'deviant' : 'cobalt');
      await store.persist.rehydrate();
      assert.equal(store.getState().textTheme, platform === 'web' ? 'deviant' : 'cobalt');
      store.getState().reset();
      assert.equal(store.getState().textTheme, platform === 'web' ? 'deviant' : 'graphite');
    }
    console.log('PASS production draft store: web branded create/restore/reset; iOS and Android theme behavior unchanged');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
