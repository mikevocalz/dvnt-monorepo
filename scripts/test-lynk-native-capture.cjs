/** Real React lifecycle regression with deterministic native SDK adapters.
 * No device permissions, microphone/camera hardware, relay or live room is used.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const dependencyPaths = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = (name) => require.resolve(name, { paths: dependencyPaths });
const dependency = (name) => require(resolve(name));

(async () => {
  const { JSDOM } = dependency('jsdom');
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.invalid/' });
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = dependency('react');
  const { createRoot } = dependency('react-dom/client');
  const device = (name) => {
    const d = { name, allowed: true, active: false, starts: 0, stops: 0, snapshot: { state: 'idle', lastError: null }, listeners: new Set() };
    d.subscribe = (listener) => { d.listeners.add(listener); return () => d.listeners.delete(listener); };
    d.getSnapshot = () => d.snapshot;
    d.emit = (state) => {
      d.snapshot = { state, lastError: state.startsWith('error:') ? state.slice(6) : ['starting', 'active'].includes(state) ? null : d.snapshot.lastError };
      for (const listener of [...d.listeners]) listener();
    };
    d.start = () => {
      d.starts++;
      d.emit('starting');
      if (d.allowed) { if (!d.deferActive) { d.active = true; d.emit('active'); } }
      else { d.active = false; d.emit(`error:${name} permission denied`); }
    };
    d.stop = () => { d.stops++; d.active = false; d.emit('idle'); };
    d.fail = () => { d.allowed = false; d.active = false; d.emit(`error:${name} permission denied`); };
    return d;
  };
  const fixture = global.__lynkCaptureFixture = {
    camera: device('Camera'), mic: device('Microphone'), sessions: new Map(),
    publications: [], currentPublication: null, invalidPublications: [], publicationStops: 0,
    peerMounts: 0, peerUnmounts: 0, settings: 0, latest: null,
    broadcasts: [{ path: 'lynk/room/peer', videoTracks: [{}], audioTracks: [{}], player: { setVolume() {} } }],
  };
  const bundle = await dependency('esbuild').build({
    stdin: { contents: `export { useLynkBroadcast } from './packages/app/lib/lynk/useLynkBroadcast.native'; export { CaptureErrorBanner } from './packages/app/features/sneaky-lynk/ui/CaptureErrorBanner'; export { leaveRoomSafely } from './packages/app/features/sneaky-lynk/session/leave-room';`, resolveDir: path.join(__dirname, '..'), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    plugins: [{ name: 'native-capture-adapter', setup(build) {
      build.onResolve({ filter: /^(react|react\/jsx-runtime)$/ }, ({ path: name }) => ({ path: resolve(name), external: true }));
      build.onResolve({ filter: /^(react-native-moq|react-native|\.\/useMoqToken)$/ }, ({ path: name }) => ({ path: name, namespace: 'capture-adapter' }));
      build.onLoad({ filter: /.*/, namespace: 'capture-adapter' }, ({ path: name }) => ({ loader: 'jsx', contents: name === './useMoqToken' ? `
        import {useMemo} from 'react';
        export function useMoqToken(room, intent, enabled=true) { return useMemo(()=>({token:room&&enabled?{relayUrl:'https://example.invalid/'+room+'/'+intent,namespace:'lynk/'+room,path:'lynk/'+room+'/self',peerId:'self'}:null,error:null}),[room,intent,enabled]); }
      ` : name === 'react-native' ? `
        import React from 'react';
        export const View=({children,accessibilityRole})=><div role={accessibilityRole}>{children}</div>;
        export const Text=({children})=><span>{children}</span>;
        export const Pressable=({children,onPress,accessibilityLabel,disabled})=><button type="button" aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>;
        export const Linking={openSettings:async()=>{globalThis.__lynkCaptureFixture.settings++}};
      ` : `
        import {useState,useCallback,useMemo,useEffect,useSyncExternalStore} from 'react';
        const f=globalThis.__lynkCaptureFixture;
        export function useSession(url) {
          if(!f.sessions.has(url))f.sessions.set(url,{state:'connected',connects:0,disconnects:0,connect(){this.connects++},disconnect(){this.disconnects++}});
          const session=f.sessions.get(url);
          return useMemo(()=>({...session,connect:()=>session.connect(),disconnect:()=>session.disconnect()}),[session]);
        }
        export const useBroadcasts=()=>f.broadcasts;
        function useDevice(d,options,type){
          const snapshot=useSyncExternalStore(d.subscribe,d.getSnapshot,d.getSnapshot);
          useEffect(()=>{if(!options.enabled)return;d.start();return()=>d.stop()},[options.enabled]);
          // The real SDK returns a new track object when state/lastError changes.
          return useMemo(()=>({...snapshot,__type:type,__name:type,position:'front',flip(){},encoder:{codec:type==='camera'?'h264':'opus'}}),[snapshot,type]);
        }
        export const useCamera=(options)=>useDevice(f.camera,options,'camera');
        export const useMicrophone=(options)=>useDevice(f.mic,options,'microphone');
        export function usePublisher(){
          const [state,setState]=useState('idle');
          f.setPublisherState=setState;
          const publish=useCallback((opts)=>{
            // Native waitForMicrophone/waitForCameraCapture cannot publish an
            // idle/failed/released source, even if the previous track is cached.
            const invalid=opts.tracks.filter(t=>t.state!=='active'||!(t.__type==='camera'?f.camera:f.mic).active);
            if(invalid.length){f.invalidPublications.push(opts);setState('error:capture not started');return;}
            assertNoOverlap();f.currentPublication=opts;f.publications.push(opts);setState('publishing');
          },[]);
          const stop=useCallback(()=>{f.currentPublication=null;f.publicationStops++;setState('stopped')},[]);
          return useMemo(()=>({state,lastError:state.startsWith('error:')?state.slice(6):null,publish,stop}),[state,publish,stop]);
        }
        function assertNoOverlap(){if(f.currentPublication)throw new Error('new publication started before previous publication stopped')}
      ` }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const { useLynkBroadcast, CaptureErrorBanner, leaveRoomSafely } = module.exports;
  function Peer() {
    React.useEffect(() => { fixture.peerMounts++; return () => fixture.peerUnmounts++; }, []);
    return React.createElement('div', { 'data-testid': 'receiving-peer' }, 'Remote participant');
  }
  function Harness({ canPublish = true }) {
    const value = useLynkBroadcast('room', canPublish);
    fixture.latest = value;
    return React.createElement(React.Fragment, null,
      React.createElement(CaptureErrorBanner, { error: value.captureError, onRetry: value.retryCapture }),
      ...value.coPublishers.map((peer) => React.createElement(Peer, { key: peer.peerId })),
    );
  }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const act = (fn) => React.act(async () => { await fn(); });
  const render = (canPublish = true) => act(() => root.render(React.createElement(Harness, { canPublish })));
  const retryButton = () => container.querySelector('[aria-label="Retry camera and microphone"]');
  const latestTypes = () => fixture.currentPublication?.tracks.map((track) => track.__type).sort();
  let unmounted = false;
  try {
    await render();
    await act(() => fixture.latest.goLive());
    assert.equal(fixture.latest.state, 'live');
    assert.deepEqual(latestTypes(), ['camera', 'microphone']);
    assert.equal(fixture.peerMounts, 1);
    const receivingSession = fixture.sessions.get('https://example.invalid/room/subscribe');
    const receiverDisconnects = receivingSession.disconnects;
    const healthyCameraStarts = fixture.camera.starts;

    const oldMicSnapshot = fixture.mic.snapshot;
    await act(() => fixture.mic.fail());
    assert.notEqual(fixture.mic.snapshot, oldMicSnapshot);
    assert.equal(fixture.latest.captureError, 'Microphone permission denied');
    assert.equal(fixture.latest.state, 'live', 'capture failure cannot restart room admission');
    assert.equal(fixture.latest.error, null);
    assert.deepEqual(latestTypes(), ['camera']);
    assert.match(container.textContent, /You can stay in the room/);
    assert.ok(container.querySelector('[role="alert"]'));
    assert.ok(retryButton());
    await act(() => fixture.setPublisherState('error:microphone capture not started'));
    assert.equal(fixture.latest.error, null, 'late capture-attributed publisher error stays local');
    assert.equal(fixture.latest.state, 'live');
    await act(() => fixture.setPublisherState('error:Publisher authorization rejected'));
    assert.equal(fixture.latest.error, 'Publisher authorization rejected', 'a simultaneous independent publisher error cannot be hidden');
    assert.equal(fixture.latest.state, 'error');
    await act(() => fixture.setPublisherState('publishing'));
    await act(() => fixture.mic.emit('idle'));
    assert.equal(fixture.latest.captureError, 'Microphone permission denied', 'idle with retained SDK lastError does not pretend recovery');
    const failedStartCount = fixture.mic.starts;
    const failedStopCount = fixture.mic.stops;
    const failurePublicationCount = fixture.publications.length;
    for (let i = 0; i < 3; i++) await act(() => fixture.latest.setMicEnabled(true));
    assert.equal(fixture.mic.starts, failedStartCount, 'automatic desired-state reconciliation never restarts denied permission');
    assert.equal(fixture.publications.length, failurePublicationCount);

    await act(() => { retryButton().click(); retryButton().click(); });
    assert.equal(fixture.mic.starts, failedStartCount + 1, 'repeated Retry in one turn coalesces');
    assert.equal(fixture.mic.stops, failedStopCount + 1, 'retry commits capture cleanup before restart');
    assert.equal(fixture.latest.captureError, 'Microphone permission denied', 'failed retry does not hide persistent error');
    assert.equal(fixture.camera.starts, healthyCameraStarts, 'healthy camera never restarts');
    assert.equal(fixture.publications.length, failurePublicationCount, 'failed retry does not republish unchanged healthy tracks');
    await act(() => container.querySelector('[aria-label="Open device settings"]').click());
    assert.equal(fixture.settings, 1);
    fixture.mic.allowed = true;
    fixture.mic.deferActive = true;
    await act(() => fixture.setPublisherState('error:microphone capture not started'));
    await act(() => retryButton().click());
    assert.equal(fixture.mic.snapshot.state, 'starting');
    assert.notEqual(fixture.latest.state, 'error', 'old capture publisher error cannot become fatal while retry is starting');
    assert.equal(fixture.latest.error, null);
    fixture.mic.deferActive = false;
    await act(() => { fixture.mic.active = true; fixture.mic.emit('active'); });
    assert.equal(fixture.latest.captureError, null);
    assert.equal(retryButton(), null);
    assert.deepEqual(latestTypes(), ['camera', 'microphone']);
    assert.equal(fixture.mic.active, true);
    assert.equal(receivingSession.disconnects, receiverDisconnects, 'retry leaves receiving transport connected');
    assert.equal(fixture.peerMounts, 1);
    assert.equal(fixture.peerUnmounts, 0);

    await act(() => { fixture.camera.fail(); fixture.mic.fail(); });
    assert.deepEqual(latestTypes(), []);
    const micBeforeMute = fixture.mic.starts;
    fixture.camera.allowed = true;
    await act(() => { fixture.latest.retryCapture(); fixture.latest.setMicEnabled(false); });
    assert.equal(fixture.mic.starts, micBeforeMute, 'host mute during retry cannot restart microphone');
    assert.equal(fixture.mic.active, false);
    assert.equal(fixture.latest.microphoneError, null);
    assert.deepEqual(latestTypes(), ['camera']);

    await act(() => fixture.camera.fail());
    const cameraBeforeRoleLoss = fixture.camera.starts;
    await act(() => { fixture.latest.retryCapture(); root.render(React.createElement(Harness, { canPublish: false })); });
    assert.equal(fixture.camera.starts, cameraBeforeRoleLoss, 'role loss cancels pending capture restart');
    assert.equal(fixture.camera.active, false);
    assert.equal(fixture.latest.captureError, null);
    assert.equal(fixture.currentPublication, null);
    assert.equal(fixture.peerUnmounts, 0, 'listener can still receive after losing publish role');

    await render(true);
    assert.equal(fixture.latest.captureError, 'Camera permission denied');
    const cameraBeforeEnd = fixture.camera.starts;
    const staleRetry = fixture.latest.retryCapture;
    await act(() => { fixture.latest.retryCapture(); fixture.latest.end(); });
    await act(() => staleRetry());
    assert.equal(fixture.camera.starts, cameraBeforeEnd, 'leave remains terminal even for a retained retry callback');
    assert.equal(fixture.camera.active, false);
    assert.equal(fixture.mic.active, false);
    assert.equal(fixture.currentPublication, null);
    assert.equal(fixture.latest.state, 'ended');
    assert.equal(fixture.invalidPublications.length, 0, 'no failed, idle, or released native track reaches publish');
    await act(() => root.unmount()); unmounted = true;
    assert.equal(fixture.peerUnmounts, 1);
    assert.equal(fixture.camera.listeners.size, 0);
    assert.equal(fixture.mic.listeners.size, 0);
    assert.ok(receivingSession.disconnects > receiverDisconnects);

    // A normal navigation unmount need not call end() first. It must also
    // cancel a Retry queued in the same turn and release every capture.
    fixture.camera.allowed = fixture.mic.allowed = true;
    const nextContainer = document.createElement('div'); document.body.append(nextContainer);
    const nextRoot = createRoot(nextContainer);
    let nextUnmounted = false;
    try {
      await act(() => nextRoot.render(React.createElement(Harness)));
      await act(() => fixture.latest.goLive());
      assert.deepEqual(latestTypes(), ['camera', 'microphone']);
      await act(() => fixture.mic.fail());
      const startsBeforeUnmount = fixture.mic.starts;
      await act(() => { fixture.latest.retryCapture(); nextRoot.unmount(); });
      nextUnmounted = true;
      assert.equal(fixture.mic.starts, startsBeforeUnmount, 'navigation cancels pending Retry');
      assert.equal(fixture.camera.active, false);
      assert.equal(fixture.mic.active, false);
      assert.equal(fixture.currentPublication, null);
      assert.equal(fixture.camera.listeners.size, 0);
      assert.equal(fixture.mic.listeners.size, 0);
      assert.equal(fixture.peerUnmounts, 2);
      assert.equal(fixture.invalidPublications.length, 0);
    } finally {
      if (!nextUnmounted) await act(() => nextRoot.unmount());
    }
    // Exercise the shipped ServerRoom consent callbacks against the REAL
    // native broadcaster, not a reimplementation of its default capture flags.
    const fs = require('node:fs');
    const ts = dependency('typescript');
    const routePath = path.join(__dirname, '../packages/app/features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx');
    const routeSource = fs.readFileSync(routePath, 'utf8');
    const ast = ts.createSourceFile(routePath, routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const server = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'ServerRoom');
    assert.ok(server, 'native ServerRoom exists');
    function actualCallback(name, scope) {
      let callback;
      function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) callback = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
      }
      visit(server);
      assert.ok(callback, `${name} must remain testable from the native screen`);
      const expression = ts.transpileModule(`(${callback.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, '');
      return new Function(...Object.keys(scope), `return ${expression}`)(...Object.values(scope));
    }
    const serverSource = server.getText(ast);
    assert.equal((serverSource.match(/videoRoom(?:Ref\.current)?\.join\(/g) || []).length, 1, 'all admission paths must use the consent wrapper');
    assert.match(serverSource, /onReconnect: joinWithReviewedMedia/);
    assert.match(serverSource, /onAdmitted:[\s\S]*?void joinWithReviewedMedia\(\)/);
    assert.match(serverSource, /const joined = await joinWithReviewedMedia\(\)/);

    fixture.camera.allowed = fixture.mic.allowed = true;
    const consentContainer = document.createElement('div'); document.body.append(consentContainer);
    const consentRoot = createRoot(consentContainer);
    let consentUnmounted = false;
    let cameraRequests = 0;
    let microphoneRequests = 0;
    let admissionCalls = 0;
    const scope = {
      leaveLifetimeRef: { current: { active: true, epoch: 1 } },
      deviceIntentEpochRef: { current: 0 },
      leavingRef: { current: false },
      closedReasonRef: { current: null },
      admissionInFlightRef: { current: null },
      micChangeInFlightRef: { current: false },
      cameraChangeInFlightRef: { current: false },
      desiredVideoEnabledRef: { current: false },
      desiredMicEnabledRef: { current: false },
      permissionsRef: { current: {
        hasCamPermission: false, hasMicPermission: false,
        requestCamPermission: async () => { cameraRequests++; return true; },
        requestMicPermission: async () => { microphoneRequests++; return true; },
      } },
      roomHasVideo: true,
      HOST_MUTE_COPY: { blocked: 'Muted by host' },
      showToast() {},
      videoRoomRef: { current: {
        isEjected: false, hostMuteLocked: false,
        get isMicOn() { return fixture.latest.micEnabled && fixture.mic.active; },
        get isCameraOn() { return fixture.latest.cameraEnabled && fixture.camera.active; },
        setCameraEnabled: async (enabled) => fixture.latest.setCameraEnabled(enabled),
        setMicEnabled: async (enabled) => {
          if (enabled && scope.videoRoomRef.current.hostMuteLocked) return false;
          fixture.latest.setMicEnabled(enabled);
          return true;
        },
        join: async () => { admissionCalls++; consentRoot.render(React.createElement(Harness, { canPublish: true })); return true; },
      } },
    };
    const joinReviewed = actualCallback('joinWithReviewedMedia', scope);
    const toggleMic = actualCallback('handleToggleMic', scope);
    const toggleCamera = actualCallback('handleToggleVideo', scope);
    try {
      await act(() => consentRoot.render(React.createElement(Harness, { canPublish: false })));
      const cameraBeforeAdmission = fixture.camera.starts;
      const microphoneBeforeAdmission = fixture.mic.starts;
      await act(() => joinReviewed());
      await act(() => fixture.latest.goLive());
      assert.equal(admissionCalls, 1);
      assert.equal(cameraRequests, 0, 'off camera never asks for permission at admission');
      assert.equal(microphoneRequests, 0, 'muted entry never asks for microphone permission');
      assert.equal(fixture.camera.starts, cameraBeforeAdmission, 'off camera never briefly starts when canPublish becomes true');
      assert.equal(fixture.mic.starts, microphoneBeforeAdmission, 'muted mic never briefly starts when canPublish becomes true');
      assert.deepEqual(latestTypes(), [], 'off/off admission publishes no capture tracks');

      // Capacity/manual retry and host-start admission use this same callback.
      await act(() => consentRoot.render(React.createElement(Harness, { canPublish: false })));
      await act(() => joinReviewed());
      assert.equal(admissionCalls, 2);
      assert.equal(fixture.camera.starts, cameraBeforeAdmission);
      assert.equal(fixture.mic.starts, microphoneBeforeAdmission);
      assert.equal(cameraRequests + microphoneRequests, 0);

      scope.videoRoomRef.current.hostMuteLocked = true;
      await act(() => toggleMic());
      assert.equal(microphoneRequests, 0, 'host lock is checked before asking for mic permission');
      assert.equal(fixture.mic.starts, microphoneBeforeAdmission);
      scope.videoRoomRef.current.hostMuteLocked = false;
      scope.permissionsRef.current.requestMicPermission = async () => { microphoneRequests++; return false; };
      await act(() => toggleMic());
      assert.equal(microphoneRequests, 1);
      assert.equal(fixture.mic.starts, microphoneBeforeAdmission, 'denied explicit enable never starts capture');

      scope.permissionsRef.current.requestMicPermission = async () => { microphoneRequests++; return true; };
      await act(() => toggleMic());
      assert.equal(microphoneRequests, 2, 'explicit mic enable requests missing OS permission');
      assert.equal(fixture.mic.active, true);
      await act(() => toggleMic());
      assert.equal(microphoneRequests, 2, 'microphone shutoff never asks for permission');
      assert.equal(fixture.mic.active, false);

      // A confirmed host Leave stops local devices before the slow server
      // response. Refusal preserves room reception, not the old media intent.
      await act(() => toggleMic());
      await act(() => toggleCamera());
      assert.equal(fixture.mic.active, true);
      assert.equal(fixture.camera.active, true);
      let resolveEnd;
      let navigations = 0;
      let leavingState = false;
      const leaveScope = { ...scope, leaveRoomSafely, isHost: true, id: 'room',
        setIsLeaving(value) { leavingState = value; },
        sneakyLynkApi: {
          endRoom: () => new Promise((resolve) => { resolveEnd = resolve; }),
          leaveRoom: async () => ({ ok: true }),
        },
        useRoomStore: { getState: () => ({ listeners: [] }) },
        reset() {}, endRoomHistory() {},
        router: { replace() { navigations++; } },
      };
      const leaveReviewed = actualCallback('doLeave', leaveScope);
      let pendingEnd;
      await act(() => { pendingEnd = leaveReviewed(); });
      assert.equal(leavingState, true);
      assert.equal(fixture.camera.active, false, 'camera stops while host end request is pending');
      assert.equal(fixture.mic.active, false, 'microphone stops while host end request is pending');
      assert.equal(scope.desiredVideoEnabledRef.current, false);
      assert.equal(scope.desiredMicEnabledRef.current, false);
      await act(async () => { resolveEnd({ ok: false, error: { message: 'Try again' } }); await pendingEnd; });
      assert.equal(leavingState, false);
      assert.equal(navigations, 0, 'refused host end stays in the room');
      assert.equal(fixture.camera.active, false, 'refused host end never restores camera');
      assert.equal(fixture.mic.active, false, 'refused host end never restores microphone');
      const cameraStartsBeforeLatePermission = fixture.camera.starts;
      const requestsBeforeLatePermission = cameraRequests;

      let resolveCamera;
      scope.permissionsRef.current.requestCamPermission = () => { cameraRequests++; return new Promise((resolve) => { resolveCamera = resolve; }); };
      const pendingCamera = toggleCamera();
      const duplicateCamera = toggleCamera();
      assert.equal(cameraRequests, requestsBeforeLatePermission + 1, 'repeated camera enable shares one in-flight permission request');
      scope.leavingRef.current = true;
      scope.deviceIntentEpochRef.current++;
      await act(async () => { resolveCamera(true); await pendingCamera; await duplicateCamera; });
      assert.equal(fixture.camera.starts, cameraStartsBeforeLatePermission, 'late camera permission after Leave cannot start capture');
      scope.leavingRef.current = false;

      let resolveMicrophone;
      scope.permissionsRef.current.requestMicPermission = () => { microphoneRequests++; return new Promise((resolve) => { resolveMicrophone = resolve; }); };
      const pendingMic = toggleMic();
      scope.leaveLifetimeRef.current.active = false;
      await act(() => { consentRoot.unmount(); consentUnmounted = true; });
      await act(async () => { resolveMicrophone(true); await pendingMic; });
      assert.equal(fixture.mic.active, false, 'permission completion after navigation cannot restart microphone');
      assert.equal(fixture.camera.active, false);
      assert.equal(fixture.currentPublication, null);
      assert.equal(fixture.invalidPublications.length, 0);
    } finally {
      if (!consentUnmounted) await act(() => consentRoot.unmount());
    }
    console.log('PASS: actual ServerRoom consent callbacks + real native broadcaster: off/off before admission and retries, zero unsolicited permission requests, explicit OS permission enable, host lock, denial, single-flight, local shutoff, late permission after leave/navigation.');
    console.log('PASS: real React native capture error/retry lifecycle, immutable SDK tracks, healthy/receiving preservation, repeated reconciliation/retry, host mute, role loss, terminal leave, cleanup, and accessible Retry/settings banner. Native SDK adapters only; no device or live transport exercised.');
  } finally {
    if (!unmounted) await act(() => root.unmount());
    window.close();
    delete global.__lynkCaptureFixture;
  }
})().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
