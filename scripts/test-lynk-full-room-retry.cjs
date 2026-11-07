/** Real shared retry hook with deterministic timers. No server or devices. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const deps = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = name => require.resolve(name, { paths: deps });
const React = require(resolve('react'));
const ts = require(resolve('typescript'));
const { JSDOM } = require(resolve('jsdom'));
const { createRoot } = require(resolve('react-dom/client'));
const rootDir = path.join(__dirname, '..');
const dom = new JSDOM('<div id="root"></div>');
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const act = fn => React.act(async () => { await fn(); });
const clock = { now: 0, timers: new Map(), id: 0 };
const fakeSet = (fn, ms = 0) => { const id = ++clock.id; clock.timers.set(id, { fn, at: clock.now + ms }); return id; };
const fakeClear = id => clock.timers.delete(id);
const FakeDate = class extends Date { static now() { return clock.now; } };
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(rootDir, 'packages/app/features/sneaky-lynk/hooks/useFullRoomRetry.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { require: name => require(resolve(name)), module: moduleObject, exports: moduleObject.exports, setTimeout: fakeSet, clearTimeout: fakeClear, Date: FakeDate });
const { useFullRoomRetry } = moduleObject.exports;
async function advance(ms) {
  const end = clock.now + ms;
  for (;;) {
    const due = [...clock.timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    clock.now = due[1].at;
    clock.timers.delete(due[0]);
    await act(() => due[1].fn());
  }
  clock.now = end;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let current;
let attempts = [];
let answer = async () => 'full';
let options = { roomKey: 'account:room', eligible: true, active: true };
function Harness() {
  current = useFullRoomRetry({ ...options, onAttempt: async context => {
    attempts.push({ at: clock.now, context });
    return answer(context);
  } });
  return null;
}
(async () => {
  let root = createRoot(document.getElementById('root'));
  const render = async patch => { options = { ...options, ...patch }; await act(() => root.render(React.createElement(Harness))); };
  try {
    await render({});
    await advance(60_000);
    assert.equal(attempts.length, 0, 'manual retry remains default');
    await act(() => current.start());
    assert.equal(current.enabled, true);
    assert.equal(current.secondsUntilRetry, 5);
    await advance(4_999);
    assert.equal(attempts.length, 0, 'opt-in respects initial cooldown');
    await advance(1);
    assert.equal(attempts.length, 1);
    assert.equal(current.cooldownSeconds, 5);
    assert.equal(current.secondsUntilRetry, 10);
    await act(async () => assert.equal(await current.retryNow(), 'stopped'));
    assert.equal(attempts.length, 1, 'repeated taps cannot bypass cooldown');
    await advance(10_000);
    assert.equal(attempts.length, 2);
    assert.equal(current.secondsUntilRetry, 20);
    await advance(20_000);
    assert.equal(attempts.length, 3);
    assert.equal(current.secondsUntilRetry, 30);
    await advance(30_000);
    assert.equal(attempts.length, 4);
    assert.deepEqual(attempts.map(x => x.at), [65_000, 75_000, 95_000, 125_000]);
    assert.equal(current.secondsUntilRetry, 30, 'backoff is capped');
    answer = async () => 'joined';
    await advance(30_000);
    assert.equal(current.enabled, false);
    await advance(60_000);
    assert.equal(attempts.length, 5, 'success consumes one real admission and stops');

    answer = async () => 'full';
    await act(() => current.start());
    await act(() => current.stop());
    await advance(60_000);
    assert.equal(attempts.length, 5, 'Stop clears queued timers');
    await act(() => current.start());
    await render({ active: false });
    await advance(60_000);
    assert.equal(current.enabled, false);
    await render({ active: true });
    await advance(60_000);
    assert.equal(attempts.length, 5, 'foreground return needs a new explicit opt-in');

    const network = deferred();
    const cleanup = deferred();
    let discarded = 0;
    answer = async context => {
      await network.promise;
      if (!context.isCurrent()) { discarded++; await cleanup.promise; return 'stopped'; }
      return 'joined';
    };
    let pending;
    await act(() => { pending = current.retryNow(); });
    assert.equal(attempts.length, 6);
    assert.equal(current.retrying, true);
    await act(() => current.stop());
    assert.equal(current.enabled, false);
    assert.equal(attempts.at(-1).context.isCurrent(), false);
    await act(() => current.start());
    assert.equal(current.enabled, false, 'cannot restart while cancelled request is pending');
    assert.equal(current.retryNow(), pending, 'manual tap reuses the in-flight promise');
    await advance(60_000);
    await act(() => network.resolve());
    assert.equal(discarded, 1);
    assert.equal(current.retrying, true, 'stale membership cleanup retains single-flight ownership');
    assert.equal(current.retryNow(), pending);
    await act(async () => { cleanup.resolve(); assert.equal(await pending, 'stopped'); });
    assert.equal(current.retrying, false);
    assert.equal(attempts.length, 6);
    await advance(5_000);
    answer = async () => 'stopped';
    await act(() => current.start());
    await advance(5_000);
    assert.equal(current.enabled, false, 'non-capacity refusal stops automatic attempts');
    await advance(60_000);
    assert.equal(attempts.length, 7);
    answer = async () => { throw new Error('offline'); };
    await act(() => current.start());
    await advance(5_000);
    assert.equal(current.enabled, false, 'unexpected/network error requires deliberate retry');
    await advance(5_000);

    let inflight = deferred();
    answer = () => inflight.promise;
    await act(() => { pending = current.retryNow(); });
    const oldContext = attempts.at(-1).context;
    await render({ roomKey: 'another-account:room' });
    assert.equal(oldContext.isCurrent(), false, 'account or room change revokes old attempt');
    await act(async () => { inflight.resolve('joined'); assert.equal(await pending, 'stopped'); });
    assert.equal(current.enabled, false);
    await advance(5_000);
    inflight = deferred();
    await act(() => { pending = current.retryNow(); });
    const unmountedContext = attempts.at(-1).context;
    await act(() => root.unmount());
    root = null;
    assert.equal(unmountedContext.isCurrent(), false);
    await act(async () => { inflight.resolve('joined'); assert.equal(await pending, 'stopped'); });
    assert.equal(clock.timers.size, 0, 'unmount cancels all retry and countdown timers');
    console.log('PASS: shared full-room retries require opt-in, back off 5/10/20/30s, single-flight through cancelled-response cleanup, manual cooldown, Stop, foreground, room/account changes, terminal/network errors and unmount. Synthetic timers/API only.');
  } finally {
    if (root) await act(() => root.unmount());
    dom.window.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
