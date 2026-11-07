/** Production selection gate + released SDK, with synthetic hardware only.
 * NODE_PATH=<tool node_modules> LYNK_SDK_DEPS=<SDK node_modules> node this-file
 * Does not establish a relay connection, request browser permission, or publish.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const paths = [...(process.env.NODE_PATH || '').split(path.delimiter), process.cwd()].filter(Boolean);
const sdkPaths = [process.env.LYNK_SDK_DEPS, ...paths].filter(Boolean);
const resolve = name => require.resolve(name, { paths: name.startsWith('@moq/') ? sdkPaths : paths });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const settle = async predicate => {
  for (let i = 0; i < 80; i++) { if (predicate()) return; await tick(); }
  throw new Error('SDK selection fixture did not settle');
};
(async () => {
  for (const [name, version] of [['@moq/publish', '0.5.2'], ['@moq/signals', '0.2.5']]) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(resolve(name)), 'package.json'), 'utf8')).version, version);
  }
  const helper = path.join(__dirname, '../packages/app/lib/lynk/selected-capture-source.web.ts');
  const built = await require(resolve('esbuild')).build({
    stdin: { contents: `export * from ${JSON.stringify(helper)};export {Signal} from '@moq/signals';`, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs', tsconfigRaw: {},
    plugins: [{ name: 'actual-released-sdk', setup(build) {
      build.onResolve({ filter: /^@moq\/(publish|signals)$/ }, ({ path: name }) => ({ path: resolve(name) }));
    } }],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, mod, mod.exports);
  const { Signal, createSelectedCamera, createSelectedMicrophone } = mod.exports;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    for (const [kind, create] of [['video', createSelectedCamera], ['audio', createSelectedMicrophone]]) {
      const devices = new EventTarget();
      let available = ['b', 'c'];
      let discoveryDeferred = true;
      const discoveries = [], calls = [], tracks = [];
      const infos = () => available.map(deviceId => ({ kind: `${kind}input`, deviceId, groupId: deviceId, label: deviceId }));
      devices.enumerateDevices = () => discoveryDeferred ? new Promise(resolve => discoveries.push(resolve)) : Promise.resolve(infos());
      devices.getUserMedia = constraints => new Promise((resolve, reject) => calls.push({ constraints, resolve, reject }));
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: devices } });
      const enabled = new Signal(true), preferred = new Signal('a');
      let source = create(enabled, preferred);
      const respond = call => {
        const track = Object.assign(new EventTarget(), {
          kind, readyState: 'live', muted: false,
          getSettings() { return { deviceId: call.constraints[kind].deviceId?.exact || 'system', sampleRate: 48000 }; },
          stop() { this.readyState = 'ended'; },
        });
        tracks.push(track);
        call.resolve({ getTracks: () => [track], getVideoTracks: () => kind === 'video' ? [track] : [], getAudioTracks: () => kind === 'audio' ? [track] : [] });
        return track;
      };
      await tick();
      assert.equal(calls.length, 0, `${kind}: initial explicit selection waits for discovery`);
      discoveryDeferred = false; discoveries.forEach(resolve => resolve(infos()));
      await tick(); await tick();
      assert.equal(calls.length, 0, `${kind}: initially absent selection stays blocked`);
      available.unshift('a'); devices.dispatchEvent(new Event('devicechange'));
      await settle(() => calls.length === 1);
      assert.equal(calls[0].constraints[kind].deviceId.exact, 'a');
      // An unchanged inventory refresh must not restart healthy/pending capture.
      devices.dispatchEvent(new Event('devicechange')); await tick(); await tick();
      assert.equal(calls.length, 1, `${kind}: unchanged discovery does not restart capture`);
      // Change twice before the pending permission/capture request resolves.
      preferred.set('b'); await settle(() => calls.length === 2);
      preferred.set('c'); await settle(() => calls.length === 3);
      const obsoleteA = respond(calls[0]), obsoleteB = respond(calls[1]), liveC = respond(calls[2]);
      await settle(() => source.device.out.active.peek() === 'c');
      assert.equal(obsoleteA.readyState, 'ended'); assert.equal(obsoleteB.readyState, 'ended');
      assert.equal(liveC.readyState, 'live');
      // Missing preferred input is blocked rather than silently selecting default.
      available = ['a', 'b']; devices.dispatchEvent(new Event('devicechange'));
      await settle(() => source.device.out.available.peek()?.length === 2);
      await tick();
      assert.equal(calls.length, 3, `${kind}: hot unplug never captures default`);
      assert.equal(liveC.readyState, 'ended');
      available.push('c'); devices.dispatchEvent(new Event('devicechange'));
      await settle(() => calls.length === 4); respond(calls[3]);
      await settle(() => source.device.out.active.peek() === 'c');
      enabled.set(false); preferred.set('a'); await tick(); await tick();
      assert.equal(calls.length, 4, `${kind}: disabled selection never captures`);
      enabled.set(true); await settle(() => calls.length === 5);
      assert.equal(calls[4].constraints[kind].deviceId.exact, 'a');
      source.close(); source.close();
      const late = respond(calls[4]); await settle(() => late.readyState === 'ended');
      preferred.set('b'); devices.dispatchEvent(new Event('devicechange')); await tick();
      assert.equal(calls.length, 5, `${kind}: teardown disposes gate and source`);
      assert.ok(tracks.every(track => track.readyState === 'ended'));
      // Terminal SDK failures recover by source replacement while retaining choice.
      source = create(enabled, preferred); await settle(() => calls.length === 6);
      calls[5].reject(new Error('Permission denied')); await settle(() => !!source.out.error.peek());
      source.close(); source = create(enabled, preferred); await settle(() => calls.length === 7);
      assert.equal(calls[6].constraints[kind].deviceId.exact, 'b'); respond(calls[6]);
      await settle(() => source.device.out.active.peek() === 'b'); source.close();
      // No explicit preference intentionally retains the normal OS default behavior.
      preferred.set(undefined); source = create(enabled, preferred);
      await settle(() => calls.length === 8);
      assert.equal(calls[7].constraints[kind].deviceId, undefined);
      source.close(); respond(calls[7]); await tick();
      preferred.set(''); source = create(enabled, preferred);
      await settle(() => calls.length === 9);
      assert.equal(calls[8].constraints[kind].deviceId, undefined);
      source.close(); respond(calls[8]); await tick();
      assert.ok(tracks.every(track => track.readyState === 'ended'));
      console.log(`PASS ${kind}: discovery, rapid switches, hotplug, mute, stale tracks, retry, default, teardown`);
    }
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
