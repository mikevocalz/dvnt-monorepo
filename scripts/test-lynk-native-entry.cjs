/** Production native entry/prejoin React tree with native/auth/API adapters.
 * Validates consent, identity and interruption behavior, not device/relay media. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deps = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = (name) => require.resolve(name, { paths: deps });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
(async () => {
  const { Window } = await import(resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = require(resolve('react'));
  const { createRoot } = require(resolve('react-dom/client'));
  const rootDir = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(rootDir, 'packages/app/features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx'), 'utf8');
  const start = source.indexOf('function PreJoinScreen('), end = source.indexOf('// ── LocalRoom:', start);
  assert.ok(start >= 0 && end > start);
  const actual = source.slice(start, end);
  const f = global.__nativeEntry = {
    params: { id: 'creator-room', isHost: '1', hasVideo: '1' }, state: { user: { id: 'account-a', authId: 'account-a' } },
    subscribers: new Set(), timers: new Map(), timerId: 0, lookups: [], identities: [], pendingVerification: [], routes: [],
    focused: true, navigationListeners: { blur: new Set(), focus: new Set() },
    cameraPermission: true, micPermission: true, cameraStarts: 0, preview: false, serverMounts: 0,
    roomStatus: 'open', identity: { kind: 'choice' },
  };
  f.changeOwner = (owner) => {
    const previous = f.state; f.state = { user: owner ? { id: owner, authId: owner } : null };
    for (const subscriber of f.subscribers) subscriber(f.state, previous);
  };
  f.lookup = async (id, options) => {
    f.lookups.push({ id, options });
    assert.equal(options?.throwOnError, true, 'entry opts into retryable lookup errors');
    if (f.lookupError) throw new Error('SECRET database URL and lookup details');
    if (f.lookupPending) return f.lookupPending;
    return f.unavailable ? null : { id, title: 'Friends together', status: f.roomStatus, hasVideo: f.hasVideo !== false, isLive: false };
  };
  f.readIdentity = async (id, options) => {
    f.identities.push({ id, options });
    assert.equal(typeof options.isCurrent, 'function');
    if (f.identityError) throw new Error('SECRET account identity failure');
    return f.identityPending ? f.identityPending : f.identity;
  };
  const bundle = await require(resolve('esbuild')).build({
    stdin: { resolveDir: rootDir, loader: 'tsx', contents: `
      import React, {useState,useRef,useCallback,useEffect,useSyncExternalStore} from 'react';
      import {getRoomEntryStatus} from './packages/app/features/sneaky-lynk/room-entry-status';
      const f=globalThis.__nativeEntry;
      const useAuthStore=selector=>useSyncExternalStore(useAuthStore.subscribe,()=>selector(f.state),()=>selector(f.state));
      useAuthStore.getState=()=>f.state;useAuthStore.subscribe=listener=>{f.subscribers.add(listener);return()=>f.subscribers.delete(listener)};
      const View=({children,accessibilityRole})=><div role={accessibilityRole}>{children}</div>,Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>,ScrollView=View,LinearGradient=View;
      const Pressable=({children,onPress,disabled,accessibilityLabel})=><button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;
      const Switch=({value,onValueChange,accessibilityLabel})=><input type="checkbox" aria-label={accessibilityLabel} checked={value} onChange={e=>onValueChange(e.currentTarget.checked)}/>;
      const ActivityIndicator=({accessibilityLabel})=><div role="progressbar" aria-label={accessibilityLabel}/>;
      const ArrowLeft=()=>null,Radio=ArrowLeft,EyeOff=ArrowLeft,VideoOff=ArrowLeft,Video=ArrowLeft,Mic=ArrowLeft,MicOff=ArrowLeft;
      const useSafeAreaInsets=()=>({top:0,bottom:0});
      const useLocalSearchParams=()=>f.params;
      const useIsFocused=()=>f.focused,navigation={addListener:(name,listener)=>{f.navigationListeners[name].add(listener);return()=>f.navigationListeners[name].delete(listener)}},useNavigation=()=>navigation;
      const router={replace:path=>f.routes.push(path)},useRouter=()=>router;
      const useCameraPermission=()=>({hasPermission:f.cameraPermission,requestPermission:async()=>{const result=f.cameraPending?await f.cameraPending:true;f.cameraPermission=result;return result}});
      const useMicrophonePermission=()=>({hasPermission:f.micPermission,requestPermission:async()=>{const result=f.micPending?await f.micPending:true;f.micPermission=result;return result}});
      const useCamera=({enabled})=>{useEffect(()=>{f.preview=enabled;if(enabled)f.cameraStarts++;return()=>{f.preview=false}},[enabled]);return {track:true}};
      const RoomVideo=()=> <div data-camera-preview/>;
      const Linking={openSettings:async()=>{}};
      const getLynkDisplayName=()=> 'Lynk',normalizeSneakyAnonLabel=label=>label;
      const sneakyLynkApi={getRoomById:f.lookup},getRoomEntryIdentity=f.readIdentity;
      const guard=(_,run)=>{if(f.deferVerification){f.pendingVerification.push(run);return false}run();return true},useVerifiedGate=()=>guard;
      const LYNKS_LIST_ROUTE='/messages';
      const setTimeout=(run,ms)=>{const id=++f.timerId;f.timers.set(id,{run,ms});return id},clearTimeout=id=>f.timers.delete(id);
      const ClosedRoomScreen=({message,onBack})=><div data-closed>{message}<button onClick={onBack}>Back to Lynks</button></div>;
      function ServerRoom(props){useEffect(()=>{f.serverMounts++;return()=>{f.server=null}},[]);f.server=props;return <div data-server>{JSON.stringify(props)}</div>}
      const LocalRoom=props=><div data-local>{props.id}</div>;
      ${actual}
      export {SneakyLynkRoomScreenContent};
    ` }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
    plugins: [{ name: 'native-entry-react', setup(build) {
      build.onResolve({ filter: /^(react|react\/jsx-runtime)$/ }, ({ path: name }) => ({ path: resolve(name), external: true }));
    } }],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, mod, mod.exports);
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node);
  const act = (fn) => React.act(async () => { await fn(); });
  const render = () => act(() => root.render(React.createElement(mod.exports.SneakyLynkRoomScreenContent)));
  const button = (label) => node.querySelector(`[aria-label="${label}"]`);
  const click = async (element) => { assert.ok(element); await act(() => element.click()); };
  const nextRoom = async (id) => { f.params = { ...f.params, id }; await render(); };
  const confirmLatest = () => act(() => f.pendingVerification.at(-1)());
  const noServer = () => assert.equal(node.querySelector('[data-server]'), null);
  try {
    await render();
    assert.ok(button('Join Lynk'), 'creator URL must not skip media review');
    assert.equal(f.serverMounts, 0); assert.equal(f.preview, false); assert.equal(f.cameraStarts, 0);
    assert.match(node.textContent, /Join muted/); assert.match(node.textContent, /Camera off/);
    await click(button('Join Lynk'));
    assert.equal(f.server.initialCameraOn, false); assert.equal(f.server.initialMicOn, false); assert.equal(f.server.anonymous, false);
    assert.equal('isHost' in f.server, false, 'URL never supplies room privilege');

    await nextRoom('explicit-choice'); noServer();
    await click(button('Turn camera on')); assert.equal(f.preview, true);
    await click(button('Join with microphone on'));
    await click(button('Hide my profile with an anonymous label'));
    await click(button('Join Lynk anonymously'));
    assert.equal(f.server.initialCameraOn, true); assert.equal(f.server.initialMicOn, true); assert.equal(f.server.anonymous, true);
    assert.equal(f.preview, false, 'preview stops when actual room takes over');

    await nextRoom('room-reused'); noServer();
    assert.match(node.textContent, /Join muted/); assert.match(node.textContent, /Camera off/);
    assert.equal(button('Hide my profile with an anonymous label').checked, false);
    f.identity = { kind: 'active', anonymous: false, anonLabel: null };
    await nextRoom('accepted-cohost');
    assert.equal(button('Hide my profile with an anonymous label'), null);
    assert.match(node.textContent, /profile remains visible/);
    await click(button('Join Lynk')); assert.equal(f.server.anonymous, false); assert.equal(f.server.initialCameraOn, false);
    f.identity = { kind: 'active', anonymous: true, anonLabel: 'Anon 17' };
    await nextRoom('anonymous-reconnect');
    assert.equal(button('Hide my profile with an anonymous label'), null); assert.match(node.textContent, /Rejoining as Anon 17/);
    await click(button('Join Lynk anonymously')); assert.equal(f.server.anonymous, true);

    f.identity = { kind: 'choice' }; f.hasVideo = false;
    await nextRoom('audio-only'); assert.equal(button('Turn camera on'), null);
    await click(button('Join Lynk')); assert.equal(f.server.initialCameraOn, false); f.hasVideo = true;
    f.deferVerification = true;
    await nextRoom('verification-old'); await click(button('Join Lynk')); noServer();
    const oldVerification = f.pendingVerification.at(-1);
    await nextRoom('verification-new'); await act(oldVerification); noServer();
    await click(button('Join Lynk')); const oldAccountVerification = f.pendingVerification.at(-1);
    await act(() => { f.changeOwner('account-b'); f.changeOwner('account-a'); oldAccountVerification(); });
    noServer(); assert.ok(button('Join Lynk'), 'account generation reloads a fresh review even after A→B→A');
    await click(button('Join Lynk')); const beforeBlurVerification=f.pendingVerification.at(-1);
    await act(() => { f.focused=false; for(const callback of f.navigationListeners.blur) callback(); f.focused=true; for(const callback of f.navigationListeners.focus) callback(); beforeBlurVerification(); });
    noServer(); assert.ok(button('Join Lynk'), 'batched blur/focus keeps a fresh review instead of reviving verification');
    await click(button('Join Lynk')); await click(button('Turn camera on')); await confirmLatest(); noServer();
    await click(button('Join Lynk')); await click(button('Hide my profile with an anonymous label')); await confirmLatest(); noServer();
    await click(button('Join Lynk anonymously')); await click(button('Back to Lynks')); await confirmLatest(); noServer();
    assert.equal(f.routes.at(-1), '/messages');
    await nextRoom('after-back'); assert.ok(button('Join Lynk'), 'reusing the content for a new room clears exited ownership');
    f.deferVerification = false;
    await click(button('Join Lynk'));
    const priorMounts = f.serverMounts;
    await act(() => f.changeOwner('account-b'));
    noServer(); assert.ok(button('Join Lynk')); assert.equal(f.serverMounts, priorMounts, 'account switch cannot auto-admit with prior consent');

    f.lookupError = true; await nextRoom('lookup-error');
    assert.match(node.textContent, /couldn't load this Lynk/); assert.doesNotMatch(node.textContent, /SECRET/);
    assert.ok(button('Try loading Lynk again')); noServer();
    f.lookupError = false; let gate = deferred(); f.lookupPending = gate.promise;
    const callsBefore = f.lookups.length;
    await act(() => { button('Try loading Lynk again').click(); button('Try loading Lynk again')?.click(); });
    assert.equal(f.lookups.length, callsBefore + 1, 'duplicate retry coalesces');
    assert.ok(button('Back to Lynks')); assert.match(node.textContent, /camera and microphone stay off/);
    const timer = [...f.timers.values()].find((timer) => timer.ms === 15000); assert.ok(timer);
    await act(timer.run); assert.match(node.textContent, /taking too long/);
    f.lookupPending = null; await click(button('Try loading Lynk again')); assert.ok(button('Join Lynk'));
    await act(() => gate.resolve({ id: 'wrong-old-room', title: 'Late old title', status: 'ended', hasVideo: true }));
    assert.ok(button('Join Lynk')); assert.doesNotMatch(node.textContent, /Late old title/);
    f.identityError = true; await nextRoom('identity-error'); assert.ok(button('Try loading Lynk again')); noServer();
    f.identityError = false; await click(button('Try loading Lynk again')); assert.ok(button('Join Lynk'));
    f.unavailable = true; await nextRoom('unavailable'); assert.match(node.textContent, /may need an invitation/); assert.ok(button('Try loading Lynk again'));
    f.unavailable = false; f.roomStatus = 'ended'; await nextRoom('ended'); assert.ok(node.querySelector('[data-closed]')); assert.equal(button('Join Lynk'), null);
    f.roomStatus = 'open';

    gate = deferred(); f.lookupPending = gate.promise; await nextRoom('pending-old-room');
    f.lookupPending = null; await nextRoom('ready-new-room');
    await act(() => gate.resolve({ id: 'pending-old-room', title: 'Wrong late room', hasVideo: false, status: 'ended' }));
    assert.ok(button('Join Lynk')); assert.doesNotMatch(node.textContent, /Wrong late room/);
    gate = deferred(); f.lookupPending = gate.promise; await nextRoom('lookup-account-a');
    f.lookupPending = null; await act(() => { f.changeOwner('account-c'); f.changeOwner('account-b'); });
    await act(() => gate.resolve({ id: 'lookup-account-a', title: 'Wrong previous account', hasVideo: true, status: 'ended' }));
    assert.ok(button('Join Lynk')); assert.doesNotMatch(node.textContent, /Wrong previous account/);

    f.cameraPermission = false; gate = deferred(); f.cameraPending = gate.promise;
    await nextRoom('permission-pending'); const startsBefore = f.cameraStarts;
    await click(button('Turn camera on')); assert.equal(button('Join Lynk').disabled, true);
    await click(button('Back to Lynks'));
    await act(() => gate.resolve(true)); assert.equal(f.cameraStarts, startsBefore, 'late permission after Back cannot start preview');
    f.cameraPending = null; f.cameraPermission = true;
    await nextRoom('blur-permission'); f.cameraPermission=false; gate=deferred(); f.cameraPending=gate.promise; await render();
    await click(button('Turn camera on'));
    await act(() => { f.focused=false; for(const callback of f.navigationListeners.blur) callback(); f.focused=true; for(const callback of f.navigationListeners.focus) callback(); });
    await act(() => gate.resolve(true)); assert.equal(f.preview,false,'late permission cannot restore a preview after navigation');
    f.cameraPending=null; f.cameraPermission=true;
    await nextRoom('space-practice'); assert.ok(node.querySelector('[data-local]'), 'local practice routing remains unchanged');

    gate = deferred(); f.lookupPending = gate.promise;
    await nextRoom('unmount-loading'); await act(() => root.unmount());
    await act(() => gate.reject(new Error('SECRET late network failure')));
    assert.equal(f.subscribers.size, 0); assert.equal(f.timers.size, 0);
    assert.equal(f.navigationListeners.blur.size,0);assert.equal(f.navigationListeners.focus.size,0);

    // Exercise the actual API method as well: a network error must not become
    // a permanent unavailable-room screen, while legacy callers keep null.
    const apiSource = fs.readFileSync(path.join(rootDir, 'packages/app/features/sneaky-lynk/api/supabase.ts'), 'utf8');
    const method = apiSource.slice(apiSource.indexOf('  async getRoomById('), apiSource.lastIndexOf('\n};'));
    const apiCode = require(resolve('esbuild')).transformSync(`const api={${method}};module.exports=api;`, { loader: 'ts', format: 'cjs' }).code;
    let answer, thrown;
    const chain = { select() { return this; }, eq() { return this; }, single: async () => { if (thrown) throw thrown; return answer; } };
    const apiModule = { exports: {} };
    new Function('module', 'supabase', 'console', apiCode)(apiModule, { from: () => chain }, { error() {} });
    answer = { data: null, error: { code: 'PGRST116', message: '0 rows' } };
    assert.equal(await apiModule.exports.getRoomById('missing', { throwOnError: true }), null);
    answer = { data: null, error: { code: 'ECONN', message: 'SECRET service details' } };
    assert.equal(await apiModule.exports.getRoomById('offline'), null);
    await assert.rejects(apiModule.exports.getRoomById('offline', { throwOnError: true }), (error) => /try again/.test(error.message) && !error.message.includes('SECRET'));
    thrown = new Error('SECRET request rejection');
    await assert.rejects(apiModule.exports.getRoomById('offline', { throwOnError: true }), /Couldn't load this Lynk/);
    console.log('PASS: native production entry/prejoin requires creator and guest media review, defaults off, preserves active named/anonymous identity, honors explicit consent, resets room/account reuse, rejects delayed verification/media/lookup across Back/A→B→A/room change/unmount, and provides bounded retryable lookup failures. API strict/legacy error behavior verified. Native/auth/network adapters only; no physical acceptance.');
  } finally {
    await act(() => root.unmount()); await window.happyDOM.close(); delete global.__nativeEntry;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
