/** Actual native room hook + Zustand store, synthetic API/media/device boundaries.
 * Exercises admission, a long VIP call, moderation, departure and late responses.
 * Does not start cameras, connect to a relay, or create real room memberships. */
const assert = require('node:assert/strict');
const path = require('node:path');
const deps = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = name => require.resolve(name, { paths: deps });
(async () => {
  const { JSDOM } = require(resolve('jsdom'));
  const dom = new JSDOM('<div id="root"></div>');
  global.window = dom.window; global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require(resolve('react'));
  const { createRoot } = require(resolve('react-dom/client'));
  const f = global.__nativeSession = {
    now: 0, timers: new Map(), nextTimer: 0, refreshes: 0, joins: 0, ended: 0,
    mic: [], errors: [], ejects: [], stoppedEvents: 0, stoppedRoster: 0,
    media: { state: 'live', isLive: true, coPublishers: [], cameraTrack: { position: 'front', flip() {} },
      cameraEnabled: true, micEnabled: true, cameraError: null, microphoneError: null,
      captureError: null, error: null, retryCapture() {}, goLive: async () => {},
      setCameraEnabled() {}, setMicEnabled(on) { f.mic.push(on); }, end() { f.ended++; } },
    response: () => ({ ok: true, data: {
      room: { id: 'room', title: 'VIP room', fishjamRoomId: 'unused-webRTC-room', endsAt: null },
      token: 'unused-webRTC-token', peer: { id: 'provider-peer-id-not-token-jti', role: 'participant' },
      user: { id: 'member', username: 'guest' }, expiresAt: new Date(f.now + 3600000).toISOString(),
    } }),
  };
  const rootDir = path.join(__dirname, '..');
  const result = await require(resolve('esbuild')).build({
    entryPoints: [path.join(rootDir, 'packages/app/features/video/hooks/useVideoRoom.ts')],
    bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'session-boundaries', setup(build) {
      build.onResolve({ filter: /^(react|zustand)$/ }, ({path:p}) => ({path: resolve(p), external: true}));
      build.onResolve({ filter: /^(react-native|.*useLynkBroadcast\.native|.*audioSession|.*auth-store|\.\.\/api|\.\.\/useRoomLifecycle)$/ }, ({path:p}) => ({path:p, namespace:'session-fake'}));
      build.onLoad({filter:/.*/,namespace:'session-fake'}, ({path:p}) => ({loader:'js', contents:
        p === 'react-native' ? `export const AppState={addEventListener(){return {remove(){}}}};` :
        p.endsWith('auth-store') ? `export const useAuthStore=s=>s({user:{id:'account',authId:'member'}});` :
        p.endsWith('audioSession') ? `export const audioSession={setMicMuted(){}};` :
        p.endsWith('useLynkBroadcast.native') ? `export const useLynkBroadcast=(room,canPublish)=>{globalThis.__nativeSession.mediaRoom=room;globalThis.__nativeSession.canPublish=canPublish;return globalThis.__nativeSession.media};` :
        p === '../useRoomLifecycle' ? `export const useRoomLifecycle=options=>{const f=globalThis.__nativeSession;f.lifecycle=options;return {notifyEnded:options.onEnded}};` :
        `const f=globalThis.__nativeSession;export const videoApi={
          joinRoom:async()=>{f.joins++;return f.pendingJoin?await f.pendingJoin:f.response()},
          refreshToken:async()=>{f.refreshes++;return {ok:false,error:{code:'forbidden',message:'Your session has been revoked'}}},
          subscribeToRoomEvents:(room,user,cb)=>{f.event=cb;return()=>f.stoppedEvents++},
          subscribeToMembers:(room,cb,opts)=>{f.roster=opts;return()=>f.stoppedRoster++},
          kickUser:async()=>({ok:true}),banUser:async()=>({ok:true}),endRoom:async()=>({ok:true})};`
      }));
      build.onResolve({ filter:/^@dvnt\/app\// }, ({path:p}) => ({path:path.join(rootDir,'packages/app',p.slice('@dvnt/app/'.length)+'.ts')}));
    }}],
  });
  const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);
  const {useVideoRoom}=mod.exports;
  let current;
  function Harness(){current=useVideoRoom({roomId:'room',onError:e=>f.errors.push(e),onEjected:e=>f.ejects.push(e)});return null;}
  const root=createRoot(document.getElementById('root'));
  const act=fn=>React.act(async()=>{await fn()});
  const originalSet=global.setTimeout, originalClear=global.clearTimeout, originalNow=Date.now;
  let unmounted=false;
  try {
    Date.now=()=>f.now;
    global.setTimeout=(cb,delay=0)=>{const id=++f.nextTimer;f.timers.set(id,{cb,at:f.now+delay});return id;};
    global.clearTimeout=id=>f.timers.delete(id);
    await act(()=>root.render(React.createElement(Harness)));
    await act(async()=>assert.equal(await current.join(),true));
    assert.equal(current.isAdmitted,true);assert.equal(f.canPublish,true);
    assert.equal(f.mediaRoom,'room');assert.equal(f.joins,1);
    // More than the old 55-minute refresh and a full 4-hour VIP room. Execute
    // only scheduled room timers; React/device/API adapters own no fake clock.
    await act(async()=>{
      f.now=4*3600000;
      for (const [id,t] of [...f.timers]) if(t.at<=f.now){f.timers.delete(id);await t.cb();}
    });
    assert.equal(f.refreshes,0,'MoQ room must not renew unused Fishjam credentials with a peer ID');
    assert.equal(f.ejects.length,0);assert.equal(current.isAdmitted,true);
    const endCount=f.ended;
    await act(()=>f.event({type:'mute_peer',targetId:'member',payload:{}}));
    assert.equal(current.hostMuteLocked,true);assert.equal(f.mic.at(-1),false);
    const count=f.mic.length;
    await act(()=>current.setMicEnabled(true));assert.equal(f.mic.length,count,'host mute blocks self-unmute');
    await act(()=>f.event({type:'unmute_peer',targetId:'member',payload:{}}));
    assert.equal(current.hostMuteLocked,false);assert.equal(f.mic.length,count,'host release never opens the mic');
    await act(()=>current.setMicEnabled(true));assert.equal(f.mic.at(-1),true);
    await act(()=>f.event({type:'eject',targetId:'member',payload:{action:'kick',reason:'Removed'}}));
    assert.equal(current.isAdmitted,false);assert.equal(f.canPublish,false);assert.equal(f.mediaRoom,undefined);
    assert.ok(f.ended>endCount);assert.equal(f.ejects.length,1);
    await act(()=>root.unmount());unmounted=true;
    assert.ok(f.stoppedEvents>0);assert.ok(f.stoppedRoster>0);

    const second=createRoot(document.getElementById('root'));
    try {
      await act(()=>second.render(React.createElement(Harness)));
      let resolveJoin;f.pendingJoin=new Promise(resolve=>resolveJoin=resolve);
      let joining;await act(()=>{joining=current.join()});
      await act(()=>current.leave());
      await act(async()=>{resolveJoin(f.response());assert.equal(await joining,false)});
      assert.equal(current.isAdmitted,false,'late admission cannot restart media after leave');
      f.pendingJoin=null;
      await act(()=>current.join());assert.equal(current.isAdmitted,true);
      await act(()=>f.lifecycle.onEnded());assert.equal(current.isAdmitted,false);
      assert.equal(f.mediaRoom,undefined,'authoritative room end still shuts transport down');
    } finally {await act(()=>second.unmount())}
    console.log('PASS: actual native room hook long VIP session, no legacy credential rotation, host-mute consent, kick, ended room, leave/late join and cleanup. API/media/device boundaries mocked; no live multi-user call.');
  } finally {
    if(!unmounted)await act(()=>root.unmount());
    global.setTimeout=originalSet;global.clearTimeout=originalClear;Date.now=originalNow;
    dom.window.close();delete global.__nativeSession;
  }
})().catch(e=>{console.error(e);process.exitCode=1});
