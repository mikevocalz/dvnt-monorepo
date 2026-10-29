// Production viewer hook and shipped signals; only relay and media decoder are
// deterministic adapters. No live rooms, devices, permissions or accounts.
const assert = require('node:assert/strict');
const path = require('node:path');
const deps = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const resolve = name => require.resolve(name, { paths: name.startsWith('@moq/') ? [process.env.LYNK_SDK_DEPS, ...deps].filter(Boolean) : deps });
(async () => {
  const esbuild = require(resolve('esbuild'));
  const signals = await esbuild.build({ stdin: { contents: `export * from ${JSON.stringify(resolve('@moq/signals'))}`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'cjs' });
  const sm = { exports: {} }; new Function('require', 'module', 'exports', signals.outputFiles[0].text)(require, sm, sm.exports);
  const React = require(resolve('react')), { createRoot } = require(resolve('react-dom/client'));
  const { JSDOM } = require(resolve('jsdom'));
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const f = global.__viewerSdk = { Signals: sm.exports, connections: [], players: [], latest: null };
  const bundle = await esbuild.build({ entryPoints: [path.join(__dirname, '../packages/app/lib/lynk/useLynkViewer.web.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'boundaries', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: resolve('react'), external: true }));
    build.onResolve({ filter: /^(@moq\/|\.\/useMoqToken)/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ contents: name === '@moq/signals' ? `export const {Signal,Computed}=globalThis.__viewerSdk.Signals;` : name === './useMoqToken' ? `export const useMoqToken=room=>({token:{relayUrl:'https://example.invalid/'+room,namespace:'lynk/'+room},error:null});` : name === '@moq/net' ? `
      const f=globalThis.__viewerSdk,{Signal}=f.Signals;
      export class Connection{constructor(){this.status=new Signal('connected');this.error=new Signal(undefined);this.paths=new Signal(new Map());this.origin=new Signal({broadcasts:()=>this.paths});this.probe=new Signal(undefined);f.connections.push(this)}close(){this.closed=true}}
      export const Time={Milli:{zero:0}};export const Path={from:p=>p};
    ` : `
      const f=globalThis.__viewerSdk,{Signal}=f.Signals;
      export class Player{constructor(props){this.props=props;this.closed=false;this.video={source:{out:{config:new Signal(undefined)}},out:{frame:new Signal(undefined),stalled:new Signal(false)}};f.players.push(this)}close(){this.closed=true}}
    ` }));
  } }] });
  const mod = { exports: {} }; new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, mod, mod.exports);
  function Harness({ room = 'room' }) { f.latest = mod.exports.useLynkViewer(room); return null; }
  const root = createRoot(document.getElementById('root'));
  const tick = () => new Promise(r => setTimeout(r, 5));
  const act = fn => React.act(async () => { await fn(); await tick(); });
  try {
    await act(() => root.render(React.createElement(Harness)));
    const connection = f.connections.at(-1), peer = 'lynk/room/peer';
    await act(() => connection.paths.set(new Map([[peer, {}]])));
    assert.equal(f.latest.publishers[0].videoAvailable, false, 'audio discovery is not usable video');
    const canvas = document.createElement('canvas');
    await act(() => f.latest.attachCanvas(peer, canvas));
    const player = f.players[0];
    await act(() => player.video.source.out.config.set({ codec: 'avc1' }));
    assert.equal(f.latest.publishers[0].videoAvailable, false, 'wait for first decoded frame');
    await act(() => player.video.out.frame.set({ timestamp: 1 }));
    assert.equal(f.latest.publishers[0].videoAvailable, true);
    const stablePublishers = f.latest.publishers;
    await act(() => player.video.out.frame.set({ timestamp: 2 }));
    assert.equal(f.latest.publishers, stablePublishers, 'normal frames never drive React tile rerenders');
    for (let i = 0; i < 3; i++) {
      await act(() => { f.latest.attachCanvas(peer, null); f.latest.attachCanvas(peer, canvas); });
      assert.equal(f.players.length, 1, 'React ref churn never restarts decoder/audio');
      assert.equal(player.closed, false);
      await act(() => player.video.source.out.config.set(undefined));
      assert.equal(f.latest.publishers[0].videoAvailable, false, 'camera suspension becomes remote avatar');
      assert.equal(player.closed, false, 'audio remains subscribed');
      await act(() => player.video.source.out.config.set({ codec: 'avc1' }));
      assert.equal(f.latest.publishers[0].videoAvailable, false, 'restored config cannot expose stale frame');
      await act(() => player.video.out.frame.set({ timestamp: i + 3 }));
      assert.equal(f.latest.publishers[0].videoAvailable, true);
    }
    await act(() => player.video.out.stalled.set(true));
    assert.equal(f.latest.publishers[0].videoAvailable, true, 'brief decoder jitter does not flash avatar');
    await act(() => player.video.source.out.config.set({ codec: 'avc1', stalled: true }));
    assert.equal(f.latest.publishers[0].videoAvailable, false, 'publisher-signaled stalled capture falls back');
    await act(() => connection.paths.set(new Map()));
    assert.equal(player.closed, true); assert.equal(f.latest.publishers.length, 0);
    await act(() => player.video.out.frame.set({ timestamp: 2 }));
    assert.equal(f.latest.publishers.length, 0, 'disposed signals cannot restore dropped peers');
    await act(() => connection.paths.set(new Map([[peer, {}]])));
    await act(() => f.latest.attachCanvas(peer, canvas));
    assert.equal(f.players.length, 2);
    await act(() => f.latest.attachCanvas(peer, null));
    assert.equal(f.players[1].closed, true, 'truly removed roster tile stops audio before discovery drops');
    await act(() => f.latest.attachCanvas(peer, canvas));
    await act(() => f.latest.leave());
    assert.ok(f.players.every(p => p.closed)); assert.equal(connection.closed, true);
    console.log('PASS production web viewer + real SDK signals: audio-only discovery, first frame, remote background avatar/recovery, stable player/audio across ref churn, jitter no-flicker, publisher stalls, peer drop/rejoin and leave cleanup. Relay/decoder mocked.');
  } finally { await act(() => root.unmount()); dom.window.close(); delete global.__viewerSdk; }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
