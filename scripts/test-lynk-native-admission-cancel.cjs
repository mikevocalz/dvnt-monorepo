/** Real native useVideoRoom cancellation boundary, mocked API/media only. */
const assert = require('node:assert/strict');
const path = require('node:path');
const deps = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = name => require.resolve(name, { paths: deps });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
(async () => {
  const { JSDOM } = require(resolve('jsdom'));
  const dom = new JSDOM('<div id="root"></div>');
  global.window = dom.window; global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require(resolve('react'));
  const { createRoot } = require(resolve('react-dom/client'));
  const f = global.__nativeAdmission = {
    owner: 'account-a', room: 'room', joins: [], errors: [], cleanup: 0,
    media: { state: 'idle', isLive: false, coPublishers: [], cameraTrack: { position: 'front', flip() {} },
      cameraEnabled: false, micEnabled: false, cameraError: null, microphoneError: null,
      captureError: null, error: null, retryCapture() {}, goLive: async () => {},
      setCameraEnabled() {}, setMicEnabled() {}, end() {} },
    response: () => ({ ok: true, data: {
      room: { id: 'room', title: 'Room', endsAt: null }, peer: { id: 'peer', role: 'participant' },
      user: { id: 'member', username: 'Anonymous 42', isAnonymous: true, anonLabel: 'Anonymous 42' },
    } }),
  };
  const rootDir = path.join(__dirname, '..');
  const result = await require(resolve('esbuild')).build({
    entryPoints: [path.join(rootDir, 'packages/app/features/video/hooks/useVideoRoom.ts')],
    bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'admission-boundaries', setup(build) {
      build.onResolve({ filter: /^(react|zustand)$/ }, ({ path: p }) => ({ path: resolve(p), external: true }));
      build.onResolve({ filter: /^(react-native|.*useLynkBroadcast\.native|.*audioSession|.*auth-store|\.\.\/api|\.\.\/useRoomLifecycle)$/ }, ({ path: p }) => ({ path: p, namespace: 'admission-fake' }));
      build.onLoad({ filter: /.*/, namespace: 'admission-fake' }, ({ path: p }) => ({ loader: 'js', contents:
        p === 'react-native' ? `export const AppState={addEventListener(){return {remove(){}}}};` :
        p.endsWith('auth-store') ? `export const useAuthStore=s=>s({user:{id:globalThis.__nativeAdmission.owner,authId:globalThis.__nativeAdmission.owner}});` :
        p.endsWith('audioSession') ? `export const audioSession={setMicMuted(){}};` :
        p.endsWith('useLynkBroadcast.native') ? `export const useLynkBroadcast=(room,canPublish)=>{const f=globalThis.__nativeAdmission;f.mediaRoom=room;f.canPublish=canPublish;return f.media};` :
        p === '../useRoomLifecycle' ? `export const useRoomLifecycle=options=>({notifyEnded:options.onEnded});` :
        `const f=globalThis.__nativeAdmission;export const videoApi={
          joinRoom:async(room,anonymous)=>{f.joins.push({room,anonymous});return f.pending?await f.pending:f.response()},
          subscribeToRoomEvents:()=>()=>{},subscribeToMembers:()=>()=>{},
          kickUser:async()=>({ok:true}),banUser:async()=>({ok:true}),endRoom:async()=>({ok:true})};`
      }));
      build.onResolve({ filter: /^@dvnt\/app\// }, ({ path: p }) => ({ path: path.join(rootDir, 'packages/app', p.slice('@dvnt/app/'.length) + '.ts') }));
    } }],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
  const { useVideoRoom } = mod.exports;
  let current;
  function Harness() { current = useVideoRoom({ roomId: f.room, anonymous: true, onError: e => f.errors.push(e) }); return null; }
  const root = createRoot(document.getElementById('root'));
  const act = fn => React.act(async () => { await fn(); });
  const render = () => act(() => root.render(React.createElement(Harness)));
  try {
    await render();
    assert.equal(f.canPublish, false);
    await act(async () => assert.equal(await current.join({ isCurrent: () => false }), false));
    assert.equal(f.joins.length, 0, 'revoked intent cannot send admission');
    f.pending = Promise.resolve({ ok: false, error: { code: 'conflict', message: 'Room is full', detail: { reason: 'room_full' } } });
    await act(async () => assert.equal(await current.join({ isCurrent: () => true }), false));
    assert.equal(f.canPublish, false, 'full response cannot start capture');
    assert.equal(current.isAdmitted, false);
    assert.equal(f.errors.length, 1);

    let request = deferred();
    const cleanup = deferred();
    f.pending = request.promise;
    let allowed = true, joining, settled = false;
    await act(() => {
      joining = current.join({ isCurrent: () => allowed, onAbandonedAdmission: async () => { f.cleanup++; await cleanup.promise; } });
      joining.then(() => { settled = true; });
    });
    assert.equal(f.canPublish, false, 'pending real admission cannot start capture');
    allowed = false;
    await act(() => request.resolve(f.response()));
    assert.equal(f.cleanup, 1);
    assert.equal(settled, false, 'caller lock cannot release before cleanup');
    assert.equal(current.isAdmitted, false);
    assert.equal(f.canPublish, false, 'cancelled success cannot publish');
    assert.equal(f.errors.length, 1, 'cancelled result must not show stale errors');
    await act(async () => { cleanup.resolve(); assert.equal(await joining, false); });
    f.pending = null;
    await act(async () => assert.equal(await current.join({ isCurrent: () => true }), true));
    assert.equal(current.isAdmitted, true);
    assert.equal(f.canPublish, true);
    assert.ok(f.joins.every(join => join.anonymous === true), 'every attempt keeps reviewed anonymous identity');
    await act(() => current.leave());

    request = deferred(); f.pending = request.promise;
    await act(() => { joining = current.join({ isCurrent: () => true, onAbandonedAdmission: async () => { f.cleanup++; } }); });
    f.owner = 'account-b';
    await render();
    await act(async () => { request.resolve(f.response()); assert.equal(await joining, false); });
    assert.equal(f.cleanup, 1, 'old account may not clean up through new account credentials');
    assert.equal(current.isAdmitted, false);
    assert.equal(f.canPublish, false);

    request = deferred(); f.pending = request.promise;
    await act(() => { joining = current.join({ isCurrent: () => true, onAbandonedAdmission: async () => { f.cleanup++; } }); });
    await act(() => current.leave());
    await act(async () => { request.resolve(f.response()); assert.equal(await joining, false); });
    assert.equal(current.isAdmitted, false, 'late response after Leave cannot reopen admission');
    assert.equal(f.canPublish, false);
    console.log('PASS: native guarded admission blocks capture before admission, rejects cancelled success, awaits stale membership cleanup, preserves anonymity, rejects account-switch/leave responses and suppresses stale errors. No live API or physical-device test.');
  } finally {
    await act(() => root.unmount());
    dom.window.close(); delete global.__nativeAdmission;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
