/** Actual production hook + @moq/signals and @moq/publish capture sources.
 * getUserMedia, relay/encoders and the receiving viewer are deterministic adapters.
 * No hardware, browser permission prompt, live room or network request is used.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dependencyPaths = [...(process.env.NODE_PATH || '').split(path.delimiter), process.cwd()].filter(Boolean);
const sdkPaths = [process.env.LYNK_SDK_DEPS, ...dependencyPaths].filter(Boolean);
const resolve = name => require.resolve(name, { paths: name.startsWith('@moq/') ? sdkPaths : dependencyPaths });
(async () => {
  const sdkPath = resolve('@moq/publish');
  const signalsPath = resolve('@moq/signals');
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(sdkPath), 'package.json'), 'utf8')).version, '0.5.2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(signalsPath), 'package.json'), 'utf8')).version, '0.2.5');
  // Bundle the shipped SDK unchanged, as the web app does. Some SDK internals
  // use extensionless ESM imports that Node's direct loader cannot resolve.
  const sdk = await require(resolve('esbuild')).build({
    stdin: { contents: `export {Source} from ${JSON.stringify(sdkPath)}; export * as Signals from ${JSON.stringify(signalsPath)};`, loader: 'js', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs',
  });
  const sdkModule = { exports: {} };
  new Function('require', 'module', 'exports', sdk.outputFiles[0].text)(require, sdkModule, sdkModule.exports);
  const { Signals, Source } = sdkModule.exports;
  const Publish = { Source };
  const React = require(resolve('react'));
  const { createRoot } = require(resolve('react-dom/client'));
  const { JSDOM } = require(resolve('jsdom'));
  const { window } = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.invalid/' });
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const f = global.__webCaptureSdk = {
    Signals, Publish, latest: null, sources: [], connections: [], publications: [], resources: [], tracks: [],
    calls: { audio: 0, video: 0 }, allowed: { audio: false, video: true }, viewerLeaves: 0,
    deferAudio: false, resolveAudio: null,
  };
  class Track extends EventTarget {
    constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; this.id = `${kind}-${f.tracks.length}`; f.tracks.push(this); }
    getSettings() { return { deviceId: `${this.kind}-fixture`, sampleRate: 48000 }; }
    stop() { this.readyState = 'ended'; }
  }
  class MediaStream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  }
  global.MediaStream = MediaStream;
  const mediaDevices = new EventTarget();
  mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'audio-fixture' }, { kind: 'videoinput', deviceId: 'video-fixture' }];
  mediaDevices.getUserMedia = async constraints => {
    const kind = constraints.audio ? 'audio' : 'video'; f.calls[kind]++;
    if (kind === 'audio' && f.deferAudio) return new Promise(resolve => { f.resolveAudio = resolve; });
    if (!f.allowed[kind]) { const error = new Error(`${kind === 'audio' ? 'Microphone' : 'Camera'} permission denied`); error.name = 'NotAllowedError'; throw error; }
    return new MediaStream([new Track(kind)]);
  };
  const permission = new EventTarget(); permission.state = 'prompt';
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices, permissions: { query: async () => permission } } });
  const bundle = await require(resolve('esbuild')).build({
    entryPoints: [path.join(__dirname, '../packages/app/lib/lynk/useLynkBroadcast.web.ts')],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
    plugins: [{ name: 'actual-capture-sdk-boundaries', setup(build) {
      build.onResolve({ filter: /^(react|react\/jsx-runtime)$/ }, ({ path: name }) => ({ path: resolve(name), external: true }));
      build.onResolve({ filter: /^(@moq\/(signals|publish|net)|\.\/useMoqToken|\.\/useLynkViewer.web)$/ }, ({ path: name }) => ({ path: name, namespace: 'capture-sdk' }));
      build.onLoad({ filter: /.*/, namespace: 'capture-sdk' }, ({ path: name }) => ({ loader: 'js', contents: name === '@moq/signals' ? `export const {Signal,Computed}=globalThis.__webCaptureSdk.Signals;` : name === './useMoqToken' ? `
        export const useMoqToken=(room,intent,enabled)=>({token:room&&enabled?{relayUrl:'https://example.invalid/'+room,path:'lynk/'+room+'/self',peerId:'self'}:null,error:null});
      ` : name === './useLynkViewer.web' ? `
        const f=globalThis.__webCaptureSdk;const leave=()=>f.viewerLeaves++;const publishers=[{path:'lynk/room/peer',peerId:'peer'}];
        const viewer={state:'live',error:null,publishers,viewerCount:1,attachCanvas(){},leave};export const useLynkViewer=()=>viewer;
      ` : name === '@moq/net' ? `
        const f=globalThis.__webCaptureSdk;const{Signal}=f.Signals;
        export class Connection{constructor(){this.closed=false;this.status=new Signal('connected');this.error=new Signal(undefined);this.origin=new Signal({});this.bandwidth=new Signal({});f.connections.push(this)}close(){this.closed=true}}
        export const Time={Milli:{zero:0}};export const Path={from:p=>p};
      ` : `
        const f=globalThis.__webCaptureSdk;const{Signal}=f.Signals;
        function wrapped(Base,kind){return class extends Base{constructor(props){super(props);this.fixtureKind=kind;this.fixtureClosed=false;f.sources.push(this)}close(){this.fixtureClosed=true;super.close()}}}
        export const Source={Camera:wrapped(f.Publish.Source.Camera,'video'),Microphone:wrapped(f.Publish.Source.Microphone,'audio')};
        export class Broadcast{constructor(props){this.props=props;this.closed=false;f.publications.push(this)}close(){this.closed=true}}
        class Capture{constructor(props){this.props=props;this.closed=false;this.out={display:new Signal(undefined)};f.resources.push(this)}close(){this.closed=true}}
        class Encoder{constructor(name,props){this.props=props;this.closed=false;f.resources.push(this)}close(){this.closed=true}}
        export const Video={Capture,Encoder};export const Audio={Capture,Encoder};
      ` }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const { useLynkBroadcast } = module.exports;
  function Harness({ canPublish = true }) { f.latest = useLynkBroadcast('room', canPublish); return null; }
  let root = createRoot(document.getElementById('root'));
  let unmounted = false;
  const tick = () => new Promise(resolve => setTimeout(resolve, 5));
  const act = fn => React.act(async () => { await fn(); await tick(); });
  const settle = async predicate => { for (let i = 0; i < 50; i++) { if (predicate()) return; await act(tick); } throw new Error('actual SDK fixture did not settle'); };
  const render = canPublish => act(() => root.render(React.createElement(Harness, { canPublish })));
  const latestSource = kind => f.sources.filter(source => source.fixtureKind === kind).at(-1);
  try {
    await render(true);
    await settle(() => f.latest.captureError === 'Microphone permission denied' && f.latest.localStream);
    await act(() => f.latest.goLive());
    assert.equal(f.calls.audio, 1);
    assert.equal(f.calls.video, 1);
    assert.equal(f.latest.error, null);
    assert.equal(f.latest.state, 'live');
    assert.equal(f.latest.coPublishers.length, 1);
    const camera = latestSource('video'), cameraTrack = f.latest.localStream.getVideoTracks()[0];
    const connection = f.connections[0], firstMic = latestSource('audio');
    const publicationsBeforeReconcile = f.publications.length;
    for (let i = 0; i < 3; i++) await act(() => f.latest.setMicEnabled(true));
    assert.equal(f.calls.audio, 1, 'desired-state reconciliation does not restart terminal SDK capture');
    assert.equal(f.publications.length, publicationsBeforeReconcile);
    await act(() => { f.latest.retryCapture(); f.latest.retryCapture(); });
    await settle(() => f.calls.audio === 2 && f.latest.captureError === 'Microphone permission denied');
    assert.equal(firstMic.fixtureClosed, true);
    assert.equal(f.sources.filter(source => source.fixtureKind === 'audio').length, 2, 'repeated Retry coalesces');
    assert.equal(latestSource('video'), camera);
    assert.equal(f.latest.localStream.getVideoTracks()[0], cameraTrack);
    assert.equal(cameraTrack.readyState, 'live');
    assert.equal(f.calls.video, 1, 'healthy camera capture never restarts');
    assert.equal(connection.closed, false);
    assert.equal(f.viewerLeaves, 0, 'local capture error does not leave receiving viewer');
    f.allowed.audio = true;
    await act(() => f.latest.retryCapture());
    await settle(() => f.latest.localAudioStream && !f.latest.captureError);
    assert.equal(f.calls.audio, 3, 'new source resets real private SDK terminal retry budget');
    assert.equal(f.latest.localAudioStream.getAudioTracks()[0].readyState, 'live');
    assert.equal(latestSource('video'), camera);
    assert.equal(f.publications.filter(publication => !publication.closed).length, 1, 'only one publication remains active after source replacement');
    await act(() => connection.error.set(new Error('Credentials rejected')));
    assert.equal(f.latest.state, 'error'); assert.equal(f.latest.error, 'Credentials rejected');
    await act(() => connection.error.set(undefined));
    assert.equal(f.latest.state, 'live');

    // Refund/retry a newly denied mic, then race explicit Retry with host mute.
    await act(() => f.latest.setMicEnabled(false));
    await settle(() => !latestSource('audio').out.source.peek());
    f.allowed.audio = false;
    await act(() => f.latest.setMicEnabled(true));
    await settle(() => !!f.latest.microphoneError);
    const callsBeforeMute = f.calls.audio;
    await act(() => { f.latest.retryCapture(); f.latest.setMicEnabled(false); });
    assert.equal(f.calls.audio, callsBeforeMute, 'host mute wins before replacement source can capture');
    assert.equal(f.latest.microphoneError, null);
    assert.equal(latestSource('audio').out.source.peek(), undefined);
    await act(() => f.latest.setMicEnabled(true));
    await settle(() => !!f.latest.microphoneError);
    const callsBeforeRoleLoss = f.calls.audio;
    await act(() => { f.latest.retryCapture(); root.render(React.createElement(Harness, { canPublish: false })); });
    assert.equal(f.calls.audio, callsBeforeRoleLoss, 'role loss keeps replacement source disabled');
    assert.equal(f.latest.captureError, null);
    assert.equal(f.publications.filter(publication => !publication.closed).length, 0);
    assert.equal(f.viewerLeaves, 0);
    await render(true); await settle(() => !!f.latest.microphoneError);
    const callsBeforeEnd = f.calls.audio;
    const staleRetry = f.latest.retryCapture;
    await act(() => { f.latest.retryCapture(); f.latest.end(); });
    await act(() => staleRetry());
    assert.equal(f.calls.audio, callsBeforeEnd, 'end and stale callbacks cannot start a replacement');
    assert.equal(f.latest.state, 'ended');
    await act(() => root.unmount()); unmounted = true;
    assert.ok(f.sources.every(source => source.fixtureClosed));
    assert.ok(f.tracks.every(track => track.readyState === 'ended'));
    assert.ok(f.resources.every(resource => resource.closed));
    assert.ok(f.publications.every(publication => publication.closed));
    assert.ok(f.connections.every(item => item.closed));

    // A pending actual SDK getUserMedia promise must stop a late track after navigation.
    f.deferAudio = true;
    const next = document.createElement('div'); document.body.append(next);
    root = createRoot(next); unmounted = false;
    await render(true); await settle(() => typeof f.resolveAudio === 'function');
    const retryAfterUnmount = f.latest.retryCapture;
    await act(() => root.unmount()); unmounted = true;
    const callsAfterUnmount = f.calls.audio;
    const late = new Track('audio'); f.resolveAudio(new MediaStream([late]));
    await act(tick);
    await act(() => retryAfterUnmount());
    assert.equal(late.readyState, 'ended', 'late captured media is released after unmount');
    assert.equal(f.calls.audio, callsAfterUnmount);
    assert.ok(f.sources.every(source => source.fixtureClosed));
    assert.ok(f.tracks.every(track => track.readyState === 'ended'));
    console.log('PASS actual web SDK capture: private terminal-budget retry, microtask signals, failed-source-only replacement, healthy capture/viewer retention, duplicate retry, host mute/role/end races, auth fatal, publication cleanup and late getUserMedia release. Media/network boundaries mocked; no audible browser/hardware verification.');
  } finally {
    if (!unmounted) await act(() => root.unmount());
    window.close(); delete global.__webCaptureSdk; delete global.MediaStream;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
