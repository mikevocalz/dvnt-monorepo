/** Actual native/web API wrappers; fake auth hydration and HTTP dispatch. */
const assert = require('node:assert/strict');
const path = require('node:path');
const deps = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = name => require.resolve(name, { paths: deps });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
(async () => {
  const f = global.__admissionDispatch = { calls: [], tokenReads: 0, token: Promise.resolve('fixture-token') };
  const root = path.join(__dirname, '..');
  const bundle = await require(resolve('esbuild')).build({
    stdin: { contents: `export {videoApi} from './packages/app/features/video/api'; export {sneakyLynkApi} from './packages/app/features/sneaky-lynk/api/supabase';`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    plugins: [{ name: 'auth-http-boundaries', setup(build) {
      build.onResolve({ filter: /^(react-native|.*lib\/auth\/identity|.*lib\/supabase\/(client|realtime))$/ }, ({ path: p }) => ({ path: p, namespace: 'dispatch-fake' }));
      build.onLoad({ filter: /.*/, namespace: 'dispatch-fake' }, ({ path: p }) => ({ loader: 'js', contents:
        p === 'react-native' ? `export const Platform={OS:'ios'};` :
        p.endsWith('identity') ? `export const requireBetterAuthToken=()=>{const f=globalThis.__admissionDispatch;f.tokenReads++;return f.token};` :
        p.endsWith('realtime') ? `export const freshChannel=()=>{throw new Error('not used')};` :
        `export const supabase={functions:{invoke:async(name,options)=>{globalThis.__admissionDispatch.calls.push({name,...options});return {data:{ok:true,data:{}},error:null}}}};`
      }));
    } }],
  });
  const moduleObject = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, moduleObject, moduleObject.exports);
  const { videoApi, sneakyLynkApi } = moduleObject.exports;
  const operations = [
    options => videoApi.joinRoom('room', true, options),
    options => sneakyLynkApi.joinRoom('room', true, options),
    options => sneakyLynkApi.leaveRoom('room', options),
  ];
  for (const operation of operations) {
    f.calls = []; f.tokenReads = 0;
    let current = false;
    assert.equal((await operation({ isCurrent: () => current })).ok, false);
    assert.equal(f.tokenReads, 0, 'already cancelled operation never requests auth');
    assert.equal(f.calls.length, 0);
    current = true;
    const token = deferred(); f.token = token.promise;
    const pending = operation({ isCurrent: () => current });
    await Promise.resolve();
    assert.equal(f.tokenReads, 1);
    current = false;
    token.resolve('fixture-token-from-later-hydration');
    assert.equal((await pending).ok, false);
    assert.equal(f.calls.length, 0, 'Stop/account switch while token hydrates blocks dispatch');
    current = true; f.token = Promise.resolve('fixture-token');
    assert.equal((await operation({ isCurrent: () => current })).ok, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].body.roomId, 'room');
    if (f.calls[0].name === 'video_join_room') assert.equal(f.calls[0].body.anonymous, true);
  }
  delete global.__admissionDispatch;
  console.log('PASS: actual native/web join and stale-admission cleanup wrappers recheck ownership before and after async auth hydration; cancelled operations never dispatch. Synthetic auth/HTTP only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
