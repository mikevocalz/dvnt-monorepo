// Actual native badge + shared countdown hook. RN primitives/AppState/clock
// adapted deterministically; no native hardware or live rooms touched.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const deps = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const resolve = name => require.resolve(name, { paths: deps });
(async () => {
  const React = require(resolve('react')), { createRoot } = require(resolve('react-dom/client'));
  const { pathToFileURL } = require('node:url');
  const { Window } = await import(pathToFileURL(resolve('happy-dom')).href);
  const window = new Window(); window.document.body.innerHTML = '<div id="root"></div>';
  const saved = { window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const f = global.__nativeCountdown = { listeners: new Set(), motion: new Set(), reduceMotion: false, animations: 0, stopped: 0 };
  const bundle = await require(resolve('esbuild')).build({ entryPoints: [path.join(__dirname, '../packages/ui/src/video/RoomTimer.native.tsx')], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', plugins: [{ name: 'native-boundary', setup(build) {
    build.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path: name }) => ({ path: resolve(name), external: true }));
    build.onResolve({ filter: /^(react-native|lucide-react-native)$/ }, ({ path: name }) => ({ path: name, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ loader: 'jsx', contents: name === 'lucide-react-native' ? `export const Clock=()=>null;` : `
      import React from 'react';const f=globalThis.__nativeCountdown;
      export const View=({children,accessibilityLabel,accessibilityLiveRegion})=><div aria-label={accessibilityLabel} aria-live={accessibilityLiveRegion}>{children}</div>;
      export const Text=({children,accessibilityLabel,accessibilityLiveRegion})=><span aria-label={accessibilityLabel} aria-live={accessibilityLiveRegion}>{children}</span>;
      export const AppState={addEventListener:(_,fn)=>{f.listeners.add(fn);return {remove:()=>f.listeners.delete(fn)}}};
      export const AccessibilityInfo={isReduceMotionEnabled:async()=>f.reduceMotion,addEventListener:(_,fn)=>{f.motion.add(fn);return {remove:()=>f.motion.delete(fn)}}};
      export const Easing={ease:0,in:x=>x,out:x=>x};
      export const Animated={View,Value:class{setValue(){}},timing:()=>({}),sequence:()=>({}),loop:()=>({start:()=>f.animations++,stop:()=>f.stopped++})};
    ` }));
  } }] });
  const mod = { exports: {} }; new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports);
  const root = createRoot(document.getElementById('root')), oldNow = Date.now;
  const start = Date.parse('2026-10-29T00:00:00Z'); let now = start; Date.now = () => now;
  let expired = 0;
  const deadline = new Date(start + 300000).toISOString();
  const act = fn => React.act(async () => { await fn(); await Promise.resolve(); });
  const render = props => act(() => root.render(React.createElement(mod.exports.RoomTimer, { compact: true, onTimeUp: () => expired++, ...props })));
  const resume = () => act(() => { for (const fn of f.listeners) fn('active'); });
  try {
    // All roles render the same badge from the authoritative deadline, even
    // when the room's createdAt metadata has not loaded.
    await render({ endsAt: deadline });
    assert.match(document.body.textContent, /Time left 5:00/); assert.equal(f.animations, 0);
    now = start + 269000; await resume(); assert.match(document.body.textContent, /Time left 0:31/);
    assert.doesNotMatch(document.body.textContent, /30 seconds or less/);
    now += 1000; await resume(); assert.match(document.body.textContent, /0:30.*30 seconds or less/);
    assert.equal(f.animations, 0, 'compact header never scales beyond narrow safe width');
    await render({ endsAt: deadline, compact: false });
    assert.equal(f.animations, 1);
    await act(() => { for (const fn of f.motion) fn(true); });
    assert.equal(f.stopped, 1); assert.match(document.body.textContent, /0:30/);
    now = start + 301000; await resume(); assert.match(document.body.textContent, /Session ended/); assert.equal(expired, 1);
    await resume(); await resume(); assert.equal(expired, 1, 'returning never restarts deadline or expiry callback');
    await render({ endsAt: null, startedAt: start }); assert.equal(document.body.textContent, '', 'explicit unlimited wins over legacy metadata');
    await render({ endsAt: 'invalid', startedAt: start }); assert.equal(document.body.textContent, '');
    // React Native exposes a bare window object, not browser DOM event APIs.
    // Keep the renderer's ownerDocument private while the production component
    // mounts, resumes, expires and cleans up against native-shaped globals.
    global.window = {};
    delete global.document;
    now = start;
    await render({ key: 'bare-native', endsAt: deadline });
    assert.match(window.document.body.textContent, /Time left 5:00/);
    now = start + 275000; await resume();
    assert.match(window.document.body.textContent, /0:25.*30 seconds or less/);
    now = start + 301000; await resume();
    assert.match(window.document.body.textContent, /Session ended/);
    assert.equal(expired, 2, 'native-shaped globals retain once-only expiry');
    await resume(); assert.equal(expired, 2);
    await act(() => root.unmount()); assert.equal(f.listeners.size, 0); assert.equal(f.motion.size, 0);
    const route = fs.readFileSync(path.join(__dirname, '../packages/app/features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx'), 'utf8');
    assert.match(route, /timerEndsAt=\{videoRoom\.serverEndsAt\}/);
    assert.match(route, /!hideTimer && \(timerEndsAt != null \|\| timerStartedAt != null\)/);
    assert.doesNotMatch(route, /hostOverlay=\{/);
    const expiryStart = route.indexOf('  const handleTimeUp = useCallback', route.indexOf('  const timerStartedAt = parseRoomStartedAt'));
    const expirySource = route.slice(expiryStart, route.indexOf('\n\n  const handleToggleMic', expiryStart));
    const order = [], cameraIntent = { current: true }, micIntent = { current: true };
    const expire = new Function('useCallback', 'desiredVideoEnabledRef', 'desiredMicEnabledRef', 'videoRoomRef', 'markRoomClosed', 'sneakyLynkApi', 'id', expirySource + '; return handleTimeUp;')(
      fn => fn, cameraIntent, micIntent,
      { current: { leave: () => { order.push('media-stop'); } } },
      () => order.push('terminal-screen'), { leaveRoom: () => { order.push('presence-leave'); return Promise.resolve(); } }, 'room');
    expire();
    assert.deepEqual(order, ['media-stop', 'terminal-screen', 'presence-leave']);
    assert.equal(cameraIntent.current, false); assert.equal(micIntent.current, false);
    assert.doesNotMatch(expirySource, /isPaidHost|handleLeave|setShowTimesUpPaywall|Alert\./, 'terminal expiry never depends on entitlement or confirmation');
    console.log('PASS native countdown: absolute deadline without createdAt, always-visible header wiring, exact 30-second warning, AppState immediate resume including bare window/no document, reduced motion, once-only expiry, unlimited/invalid deadline and listener cleanup. Native primitives mocked.');
  } finally { Date.now = oldNow; window.happyDOM.abort(); window.close(); delete global.__nativeCountdown; for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value; } }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
