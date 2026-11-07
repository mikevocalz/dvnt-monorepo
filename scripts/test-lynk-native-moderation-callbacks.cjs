/** Executes the production native screen callback block with React hooks.
 * Native alerts, auth, and network are controlled adapters. No device/relay test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deps = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = (name) => require.resolve(name, { paths: deps });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
(async () => {
  const { Window } = await import(resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = require(resolve('react'));
  const { createRoot } = require(resolve('react-dom/client'));
  const rootDir = path.resolve(__dirname, '..');
  const screen = fs.readFileSync(path.join(rootDir, 'packages/app/features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx'), 'utf8');
  const extract = (start, end) => {
    const from = screen.indexOf(start, screen.indexOf('function ServerRoom(')), to = screen.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `production block is present: ${start}`);
    return screen.slice(from, to);
  };
  const callbackBlock = extract('  // ── Native moderation callbacks:', '  // ── End native moderation callbacks');
  const lifetimeBlock = extract('  const leaveLifetimeRef = useRef(', '  const deviceIntentEpochRef');
  const accountBlock = extract('  useEffect(() => useAuthStore.subscribe((next, previous) => {', '\n\n  // Heartbeat the waiting room');
  assert.ok(screen.includes('onInviteToSpeak={handleInviteToSpeak}'), 'queue must await production confirmation instead of closing first');
  const f = global.__nativeModerationCallbacks = {
    owner: 'account-a', authenticated: true, roomId: 'room-a', alerts: [], toasts: [], cleared: [], calls: [], dispatched: [], listeners: new Set(), closes: 0,
  };
  const authStore = {
    getState: () => ({ user: { id: f.owner, authId: f.owner }, isAuthenticated: f.authenticated, _hasHydrated: true, authStatus: f.authenticated ? 'authenticated' : 'unauthenticated' }),
    subscribe: (listener) => { f.listeners.add(listener); return () => f.listeners.delete(listener); },
  };
  f.changeOwner = (owner) => {
    const previous = authStore.getState(); f.owner = owner;
    for (const listener of f.listeners) listener(authStore.getState(), previous);
  };
  f.changeAuth = authenticated => {const previous=authStore.getState();f.authenticated=authenticated;for(const listener of f.listeners)listener(authStore.getState(),previous)};
  f.authStore = authStore;
  f.api = Object.fromEntries(['mutePeer', 'unmutePeer', 'kickUser', 'changeRole', 'muteAll', 'unmuteAll'].map((method) => [method, async (params, options) => {
    assert.equal(typeof options?.isCurrent, 'function', `${method} must guard token lookup`);
    f.calls.push({ method, params });
    const tokenGate = f.tokenGate, responseGate = f.responseGate, failure = f.failure;
    if (tokenGate) await tokenGate;
    if (!options.isCurrent()) return { ok: false, error: { message: 'private stale request detail' } };
    f.dispatched.push({ method, params });
    if (responseGate) await responseGate;
    if (failure === 'throw') throw new Error('private backend token and exception');
    return failure ? { ok: false, error: { message: 'private backend SQL and internal URL' } } : { ok: true };
  }]));
  f.room = {
    room: { id: f.roomId, status: 'open' }, isAdmitted: true, isEjected: false,
    localUser: { id: 'actor', role: 'host' },
    participants: Array.from({ length: 29 }, (_, i) => ({ userId: `guest-${i}`, role: i === 1 ? 'co-host' : i === 2 ? 'moderator' : 'participant' })),
  };
  const result = await require(resolve('esbuild')).build({
    stdin: { resolveDir: rootDir, loader: 'tsx', contents: `
      import {useState, useRef, useCallback, useEffect} from 'react';
      import {participantModeration} from './packages/app/features/sneaky-lynk/ui/moderation-permissions';
      import {authenticatedLynkAccount} from './packages/app/features/sneaky-lynk/room-entry-auth';
      const f=globalThis.__nativeModerationCallbacks;
      const useAuthStore=f.authStore, videoApi=f.api;
      const Alert={alert:(title,message,buttons,options)=>f.alerts.push({title,message,buttons,options})};
      const showToast=(...args)=>f.toasts.push(args), setRaisedHand=(...args)=>f.cleared.push(args);
      const clearRaisedHands=()=>f.cleared.push(['*',false]), closeHandQueue=()=>f.closes++;
      const fullRoomRetry={stop(){}};
      export function Harness(){
        const authUser=useAuthStore.getState().user, roomUuid=f.roomId;
        const videoRoomRef=useRef(f.room); videoRoomRef.current=f.room;
        const authIntentEpochRef=useRef(0), deviceIntentEpochRef=useRef(0);
        const leavingRef=useRef(false), closedReasonRef=useRef(null);
        ${lifetimeBlock}
        ${accountBlock}
        const [allMuted,setAllMuted]=useState(false), [actionTarget,setActionTarget]=useState(null);
        ${callbackBlock}
        f.current={handleMutePeer,handleUnmutePeer,handleRemoveUser,handleMakeCoHost,handleDemote,handleToggleMuteAll,handleInviteToSpeak,handleLowerHand,handleLowerAll};
        f.refs={videoRoomRef,leavingRef,closedReasonRef,leaveLifetimeRef}; f.allMuted=allMuted;
        return null;
      }
    ` }, bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'react-boundary', setup(build) { build.onResolve({ filter: /^react$/ }, ({ path: name }) => ({ path: resolve(name), external: true })); } }],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
  const node = document.createElement('div'); document.body.append(node);
  let root = createRoot(node), unmounted = false;
  const act = (fn) => React.act(async () => { await fn(); });
  const render = () => act(() => root.render(React.createElement(mod.exports.Harness)));
  const run = async (callback, ...args) => { let value; await act(async () => { value = await f.current[callback](...args); }); return value; };
  const setActor = (role) => { f.room.localUser = { id: 'actor', role }; };
  const target = () => f.room.participants[0];
  const confirm = async (label) => { const alert = f.alerts.at(-1); assert.ok(alert); await act(() => alert.buttons.find((button) => button.text === label).onPress()); };
  try {
    await render();
    for (const role of ['host', 'co-host', 'moderator', 'participant', 'speaker']) {
      setActor(role);
      assert.equal(await run('handleMutePeer', 'guest-0'), ['host', 'co-host', 'moderator'].includes(role));
      assert.equal(await run('handleUnmutePeer', 'guest-0'), ['host', 'co-host', 'moderator'].includes(role));
      assert.equal(await run('handleRemoveUser', 'guest-0'), ['host', 'co-host', 'moderator'].includes(role));
      assert.equal(await run('handleMakeCoHost', 'guest-0'), role === 'host');
      assert.equal(await run('handleDemote', 'guest-1'), role === 'host');
      assert.equal(await run('handleDemote', 'guest-0'), false, 'cannot demote an ordinary participant');
      assert.equal(await run('handleMakeCoHost', 'guest-1'), false, 'already co-host does not create another promotion');
      assert.equal(await run('handleRemoveUser', 'guest-2'), role === 'host' || role === 'co-host', 'moderator cannot remove peer moderator');
    }
    setActor('host');
    target().role = 'host';
    for (const handler of ['handleMutePeer', 'handleUnmutePeer', 'handleMakeCoHost', 'handleDemote', 'handleRemoveUser']) {
      assert.equal(await run(handler, 'guest-0'), false, 'host remains protected');
      assert.equal(await run(handler, 'actor'), false, 'cannot target self');
      assert.equal(await run(handler, 'departed'), false, 'cannot target a departed member');
    }
    target().role = 'participant';

    let pending, gate = deferred(), before = f.dispatched.length;
    f.responseGate = gate.promise;
    await act(() => { pending = f.current.handleMutePeer('guest-0'); });
    assert.equal(f.dispatched.length, before + 1);
    assert.equal(await run('handleRemoveUser', 'guest-0'), false, 'another panel shares the target lock');
    assert.equal(await run('handleToggleMuteAll'), false, 'bulk waits for target operations');
    gate.resolve(); assert.equal(await pending, true); f.responseGate = null;

    for (const role of ['co-host', 'moderator', 'participant']) {
      setActor(role); assert.equal(await run('handleToggleMuteAll'), false, 'only host may change all microphones');
    }
    setActor('host'); gate = deferred(); f.responseGate = gate.promise;
    await act(() => { pending = f.current.handleToggleMuteAll(); });
    assert.equal(f.allMuted, false, 'bulk state is not optimistic');
    assert.equal(await run('handleMutePeer', 'guest-0'), false, 'bulk excludes every target');
    assert.equal(await run('handleToggleMuteAll'), false, 'bulk duplicate is blocked');
    await act(async () => { gate.resolve(); assert.equal(await pending, true); }); f.responseGate = null;
    assert.equal(f.allMuted, true);
    assert.equal(await run('handleToggleMuteAll'), true); assert.equal(f.allMuted, false);
    assert.match(f.toasts.at(-1)[2], /choose to unmute/);
    assert.ok(!JSON.stringify(f.toasts).includes('have been unmuted'), 'never promises an opened microphone');

    before = f.dispatched.length; const closeBefore = f.closes, clearBefore = f.cleared.length;
    await act(() => { pending = f.current.handleInviteToSpeak('guest-0'); });
    assert.match(f.alerts.at(-1).message, /co-host controls/);
    assert.equal(await run('handleInviteToSpeak', 'guest-0'), false, 'repeat promotion cannot stack confirmations');
    assert.equal(await run('handleMutePeer', 'guest-0'), false, 'confirmation holds target lock');
    await run('handleLowerHand', 'guest-0'); await run('handleLowerAll');
    assert.equal(f.cleared.length, clearBefore, 'local dismissal cannot hide a pending role change');
    assert.equal(f.closes, closeBefore, 'queue stays open during confirmation');
    await confirm('Cancel'); assert.equal(await pending, false); assert.equal(f.dispatched.length, before);
    await act(() => { pending = f.current.handleInviteToSpeak('guest-0'); });
    await act(() => f.alerts.at(-1).options.onDismiss()); assert.equal(await pending, false, 'back/outside dismissal resolves cancellation');

    for (const failure of ['error', 'throw']) {
      f.failure = failure;
      await act(() => { pending = f.current.handleInviteToSpeak('guest-0'); });
      await confirm('Make co-host'); assert.equal(await pending, false);
      assert.equal(f.cleared.length, clearBefore, 'failed promotion keeps the raised hand');
      assert.equal(f.closes, closeBefore);
      assert.equal(target().role, 'participant', 'failed role change cannot alter authoritative role');
      assert.ok(!JSON.stringify(f.toasts).includes('private backend'), 'backend details stay out of toast');
    }
    f.failure = null;
    await act(() => { pending = f.current.handleInviteToSpeak('guest-0'); });
    await confirm('Make co-host'); assert.equal(await pending, true);
    assert.equal(f.cleared.length, clearBefore + 1);
    assert.equal(target().role, 'participant', 'even acknowledged role change waits for authoritative roster');

    for (const invalidate of [
      () => { target().role = 'host'; },
      () => { f.room.participants = f.room.participants.filter((member) => member.userId !== 'guest-0'); },
      () => setActor('co-host'),
      () => { f.refs.leavingRef.current = true; },
      () => { f.refs.closedReasonRef.current = 'ended'; },
      () => { f.room.isEjected = true; },
      () => { f.room.isAdmitted = false; },
      () => { f.room.room.status = 'ended'; },
      () => { f.changeOwner('account-b'); f.changeOwner('account-a'); },
      () => { f.changeAuth(false); f.changeAuth(true); },
    ]) {
      const savedParticipants = f.room.participants.map((member) => ({ ...member }));
      before = f.dispatched.length;
      await act(() => { pending = f.current.handleInviteToSpeak('guest-0'); });
      invalidate();
      await confirm('Make co-host'); assert.equal(await pending, false, 'stale confirmation must be revoked');
      assert.equal(f.dispatched.length, before);
      f.room.participants = savedParticipants; setActor('host');
      f.refs.leavingRef.current = false; f.refs.closedReasonRef.current = null;
      f.room.isAdmitted = true; f.room.isEjected = false; f.room.room.status = 'open';
    }

    for (const invalidate of [
      () => { target().role = 'host'; },
      () => setActor('participant'),
      () => { f.changeOwner('account-b'); f.changeOwner('account-a'); },
      () => { f.changeAuth(false); f.changeAuth(true); },
    ]) {
      gate = deferred(); f.tokenGate = gate.promise; before = f.dispatched.length;
      await act(() => { pending = f.current.handleMutePeer('guest-0'); });
      invalidate(); gate.resolve(); assert.equal(await pending, false);
      assert.equal(f.dispatched.length, before, 'token lookup cannot dispatch a stale moderation operation');
      f.tokenGate = null; target().role = 'participant'; setActor('host');
    }

    for (const invalidate of [
      () => { f.changeOwner('account-b'); f.changeOwner('account-a'); },
      () => { f.changeAuth(false); f.changeAuth(true); },
      () => { f.refs.leavingRef.current = true; },
      () => { f.refs.closedReasonRef.current = 'closed'; },
      () => { f.room.isEjected = true; },
      () => setActor('participant'),
      async () => { f.roomId = 'room-b'; await render(); },
    ]) {
      gate = deferred(); f.responseGate = gate.promise;
      const toastBefore = f.toasts.length, raisedBefore = f.cleared.length;
      await act(() => { pending = f.current.handleMakeCoHost('guest-0'); });
      await invalidate(); gate.resolve(); assert.equal(await pending, false);
      assert.equal(f.toasts.length, toastBefore, 'late response cannot show stale success');
      assert.equal(f.cleared.length, raisedBefore, 'late response cannot mutate the next room queue');
      f.responseGate = null; f.roomId = 'room-a'; f.refs.leavingRef.current = false; f.refs.closedReasonRef.current = null;
      f.room.isEjected = false; setActor('host'); await render();
    }

    f.failure = 'throw'; assert.equal(await run('handleToggleMuteAll'), false); assert.equal(f.allMuted, false);
    f.failure = null; assert.equal(await run('handleMutePeer', 'guest-0'), true, 'failure always releases operation lock');
    gate = deferred(); f.responseGate = gate.promise; const toastBefore = f.toasts.length;
    await act(() => { pending = f.current.handleMakeCoHost('guest-0'); });
    await act(() => root.unmount()); unmounted = true;
    gate.resolve(); assert.equal(await pending, false); assert.equal(f.toasts.length, toastBefore);
    assert.equal(f.listeners.size, 0, 'auth generation subscription cleans up');
    console.log('PASS: production native callbacks enforce host/co-host/moderator matrix, 30-person roster targeting, cross-panel/bulk single-flight, confirmation cancellation, safe errors, server-confirmed hand queue, opt-in unmute, token lookup revocation, A→B→A ownership, room/role/leave/end/eject/unmount stale-result suppression. Native alerts/network/media are adapters; no physical multi-device acceptance.');
  } finally {
    if (!unmounted) await act(() => root.unmount());
    await window.happyDOM.close(); delete global.__nativeModerationCallbacks;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
