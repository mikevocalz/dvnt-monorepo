/** Execute the installed publisher patch; only browser media primitives are faked. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const patch = readFileSync(path.join(__dirname, '../pnpm-patches/@moq__publish@0.5.2.patch'), 'utf8');
const packageRoot = process.env.LYNK_PUBLISH_PACKAGE || path.dirname(require.resolve('@moq/publish', {
  paths: [process.env.LYNK_PROBE_DEPS || process.cwd(), path.join(__dirname, '../apps/web')],
}));
assert.equal(JSON.parse(readFileSync(path.join(packageRoot, 'package.json'))).version, '0.5.2');
const processorName = patch.match(/^\+\+\+ b\/(video-[\w-]+\.js)$/m)[1];
const processorSource = readFileSync(path.join(packageRoot, processorName), 'utf8');
const helper = readFileSync(path.join(packageRoot, 'video/normalize-orientation.js'), 'utf8');
const expectedHelper = patch.split('+++ b/video/normalize-orientation.js\n')[1].split('diff --git ')[0].split('\n')
  .filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n') + '\n';
assert.equal(helper, expectedHelper, 'installed orientation helper must match the committed patch');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = promise => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error('capture did not settle')), 1500); timer.unref();
})]);
function fakeFrame(rotation = 0, flip = false, overrides = {}) {
  return { rotation, flip, displayWidth: rotation % 180 ? 32 : 64, displayHeight: rotation % 180 ? 64 : 32,
    timestamp: 123456, duration: 33333, closes: 0, close() { this.closes++; }, ...overrides };
}
function harness(options = {}) {
  const frames = [], canvases = [], draws = [], workers = [];
  let attempts = 0, now = 100, capture;
  const track = new EventTarget();
  Object.assign(track, { readyState: 'live', stops: 0, clones: [],
    getSettings: () => ({ frameRate: options.frameRate ?? 1000 }),
    stop() { this.stops++; this.readyState = 'ended'; },
    clone() { const cloned = { stops: 0, stop() { this.stops++; } }; this.clones.push(cloned); return cloned; },
  });
  const video = { readyState: options.readyState ?? 2, videoWidth: options.width ?? 64, videoHeight: 32, pauses: 0,
    play() { return options.playPromise ?? (options.playError ? Promise.reject(options.playError) : Promise.resolve()); },
    pause() { this.pauses++; },
  };
  const canvas = (width, height) => ({ width, height, getContext: () => options.contextError ? null : {
    clearRect() {}, drawImage(...args) { if (options.drawError) throw options.drawError; draws.push(args); },
  } });
  const Frame = class {
    constructor(input, init) {
      attempts++;
      const failure = options.failures?.shift(); if (failure) throw failure;
      assert.notEqual(input, video, 'fallback must rasterize the presentation, never extract opaque sensor pixels');
      Object.assign(this, fakeFrame(input.rotation ?? 0, input.flip ?? false), {
        displayWidth: input.displayWidth ?? input.width, displayHeight: input.displayHeight ?? input.height,
        timestamp: input.timestamp, duration: input.duration, ...init,
      });
      frames.push(this);
    }
  };
  // Match browser capability exposure separately from per-frame metadata values.
  for (const [key, value] of [['rotation', 0], ['flip', false]]) {
    if (!options.missingOrientation?.includes(key)) Object.defineProperty(Frame.prototype, key,
      { value, writable: true, configurable: true });
  }
  const document = { createElement(name) {
    if (name === 'video') return video;
    assert.equal(name, 'canvas'); const result = canvas(300, 150); canvases.push(result); return result;
  } };
  const Canvas = class { constructor(width, height) { const result = canvas(width, height); canvases.push(result); return result; } };
  const environment = { document, VideoFrame: Frame, OffscreenCanvas: Canvas, MediaStream: class {}, ReadableStream, TransformStream,
    DOMException, performance: { now: () => ++now, timeOrigin: 100000 }, setTimeout, clearTimeout, console: { warn() {} },
  };
  const Worker = options.Worker || class {
    constructor() { workers.push(this); queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', supported: options.workerSupported ?? true } })); }
    postMessage(message, transfer) { this.messages ??= []; this.messages.push({ message, transfer }); if (options.postError) throw options.postError; }
    terminate() { this.terminations = (this.terminations || 0) + 1; }
    emit(message) { this.onmessage?.({ data: message }); }
  };
  const Processor = class {
    constructor() { this.readable = new ReadableStream({ start(c) { capture = c; }, cancel() { track.captureCancelled = true; } }, { highWaterMark: 0 }); }
  };
  Object.assign(environment, { Worker, self: options.native ? { MediaStreamTrackProcessor: Processor } : {}, MediaStreamTrackProcessor: Processor });
  const names = Object.keys(environment), values = Object.values(environment);
  const helpers = new Function(...names, helper.replaceAll('export function ', 'function ') + '\nreturn { createOrientationNormalizer, createVideoElementCapture, createVideoElementProcessor };')(...values);
  const source = processorSource.replace(/^import .*;\n/gm, '')
    .replace(/^export \{.*\};$/m, 'return { createProcessor: a, Stamper: c, worker: u, port: f, fallback: p, deferred: m };');
  const processor = new Function(...names, ...Object.keys(helpers), 't', source)(...values, ...Object.values(helpers), { Hacks: { isSafari: false } });
  return { ...helpers, ...processor, video, track, frames, canvases, draws, workers,
    attempts: () => attempts, capture: () => capture,
  };
}

test('patch has exact Git hunk lengths and both capture branches use the shared normalizer', () => {
  const files = patch.split(/^diff --git /m).slice(1);
  assert.equal(files.length, 2);
  assert.match(files.find(file => file.startsWith('a/video/normalize-orientation.js ')), /\nnew file mode 100644\n/);
  for (const file of files) {
    const lines = file.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
      if (!header) continue;
      let oldCount = 0, newCount = 0;
      for (let j = i + 1; j < lines.length && !lines[j].startsWith('@@'); j++) {
        const line = lines[j]; if (!line || line.startsWith('\\ No newline')) continue;
        assert.ok(/^[ +\-]/.test(line));
        if (/^[ -]/.test(line)) oldCount++; if (/^[ +]/.test(line)) newCount++;
      }
      assert.equal(oldCount, Number(header[2] ?? 1)); assert.equal(newCount, Number(header[4] ?? 1));
    }
  }
  assert.match(processorSource, /return this\.#normalize\(i\)/);
  assert.match(processorSource, /n\.enqueue\(e\.stamp\(t, performance\.now\(\)\)\)/);
  assert.match(processorSource, /e\.enqueue\(r\.stamp\(n\.frame, n\.at - performance\.timeOrigin\)\)/);
  assert.doesNotMatch(helper, /getUserMedia|\.stop\(|screen\.orientation|facingMode/);
});

test('normalizer preserves all eight explicit rotations/flips, consumes replacements, and reuses canvas', () => {
  const h = harness(), normalize = h.createOrientationNormalizer();
  for (const rotation of [0, 90, 180, 270]) for (const flip of [false, true]) {
    const input = fakeFrame(rotation, flip), output = normalize(input);
    if (!rotation && !flip) { assert.equal(output, input); assert.equal(input.closes, 0); continue; }
    assert.notEqual(output, input); assert.equal(input.closes, 1);
    assert.equal(output.rotation, 0); assert.equal(output.flip, false);
    assert.equal(output.timestamp, input.timestamp); assert.equal(output.duration, input.duration);
    assert.equal(output.displayWidth, input.displayWidth); assert.equal(output.displayHeight, input.displayHeight);
  }
  assert.equal(h.canvases.length, 1); assert.equal(h.draws.length, 7);
  const cropped = fakeFrame(90, true, { displayWidth: 48, displayHeight: 96, codedWidth: 128, codedHeight: 64, duration: null });
  const output = normalize(cropped); assert.equal(output.displayWidth, 48); assert.equal(output.displayHeight, 96);
  assert.equal(output.duration, undefined); assert.deepEqual(h.draws.at(-1).slice(1), [0, 0, 48, 96]);
});

test('missing or partial orientation getters rasterize instead of assuming the frame is upright', () => {
  const h = harness(), normalize = h.createOrientationNormalizer();
  for (const [rotation, flip] of [[undefined, undefined], [0, undefined], [undefined, false]]) {
    const input = fakeFrame(0, false, { rotation, flip, displayWidth: 32, displayHeight: 64 });
    const output = normalize(input);
    assert.notEqual(output, input, 'missing getters are unknown orientation, not upright');
    assert.equal(input.closes, 1); assert.equal(output.closes, 0);
    assert.equal(output.displayWidth, 32); assert.equal(output.displayHeight, 64);
    assert.equal(output.timestamp, input.timestamp); assert.equal(output.duration, input.duration);
    assert.equal(h.draws.at(-1)[0], input); output.close();
  }
  assert.equal(h.draws.length, 3); assert.equal(h.canvases.length, 1);
  const upright = fakeFrame(0, false);
  assert.equal(normalize(upright), upright); assert.equal(upright.closes, 0);
});

test('normalizer propagates canvas/draw/allocation failures and closes its owned input exactly once', () => {
  for (const options of [{ contextError: true }, { drawError: new Error('draw') }, { failures: [new Error('allocation')] }]) {
    const h = harness(options), input = fakeFrame(90);
    assert.throws(() => h.createOrientationNormalizer()(input), /2D canvas|draw|allocation/);
    assert.equal(input.closes, 1);
  }
});

test('shared stamper keeps native changing and opaque constant timestamp epochs before normalizing', () => {
  for (const constant of [false, true]) {
    const h = harness(), stamp = new h.Stamper();
    const first = fakeFrame(90, true, { timestamp: 1000 });
    const second = fakeFrame(270, false, { timestamp: constant ? 1000 : 4000 });
    const a = stamp.stamp(first, 20), b = stamp.stamp(second, 30);
    assert.equal(a.timestamp, 20000); assert.equal(b.timestamp, constant ? 30000 : 23000);
    for (const raw of [first, second]) assert.equal(raw.closes, 1);
    for (const result of [a, b]) { assert.equal(result.rotation, 0); assert.equal(result.flip, false); assert.equal(result.closes, 0); result.close(); }
    assert.ok(h.frames.filter(f => f.rotation).every(f => f.closes === 1));
  }
  const h = harness({ failures: [new Error('clone failed')] }), raw = fakeFrame(90);
  assert.throws(() => new h.Stamper().stamp(raw, 1), /clone failed/); assert.equal(raw.closes, 1);
});

test('actual native capture branch normalizes and cancels without stopping caller track', async () => {
  const h = harness({ native: true }), reader = h.createProcessor(h.track).getReader();
  const raw = fakeFrame(90, true), pending = reader.read(); h.capture().enqueue(raw);
  const { value } = await bounded(pending);
  assert.equal(value.rotation, 0); assert.equal(value.flip, false); assert.equal(raw.closes, 1);
  value.close(); await reader.cancel(); await delay(0);
  assert.equal(h.track.captureCancelled, true); assert.equal(h.track.stops, 0);
});

test('missing prototype orientation capabilities bypass native and worker capture with live presentation dimensions', async () => {
  for (const native of [false, true]) for (const missingOrientation of [['rotation'], ['flip'], ['rotation', 'flip']]) {
    const h = harness({ native, missingOrientation, width: 32 }); h.video.videoHeight = 64;
    const reader = h.createProcessor(h.track).getReader();
    try {
      const first = (await bounded(reader.read())).value;
      assert.equal(h.capture(), undefined, 'native processor must not start without complete orientation capability');
      assert.equal(h.workers.length, 0, 'worker must not even be attempted');
      assert.equal(h.track.clones.length, 0);
      assert.deepEqual([first.displayWidth, first.displayHeight], [32, 64]);
      assert.deepEqual(h.draws.at(-1), [h.video, 0, 0, 32, 64]);
      h.video.videoWidth = 64; h.video.videoHeight = 32;
      const next = (await bounded(reader.read())).value;
      assert.deepEqual([next.displayWidth, next.displayHeight], [64, 32]);
      assert.deepEqual(h.draws.at(-1), [h.video, 0, 0, 64, 32]);
      assert.ok(next.timestamp > first.timestamp); first.close(); next.close();
    } finally { await reader.cancel(); }
    assert.equal(h.video.srcObject, null); assert.equal(h.track.stops, 0);
  }
});

test('orientation-capable track still falls back when the worker processor is unsupported', async () => {
  const h = harness({ workerSupported: false }), reader = h.createProcessor(h.track).getReader();
  const frame = (await bounded(reader.read())).value;
  assert.equal(h.workers.length, 1); assert.equal(h.workers[0].terminations, 1);
  assert.deepEqual(h.draws.at(-1), [h.video, 0, 0, 64, 32]);
  frame.close(); await reader.cancel(); assert.equal(h.track.stops, 0);
});

test('actual worker branch normalizes transferred frames, preserves epoch, and respects demand', async () => {
  const h = harness(), stream = await h.worker(h.track), worker = h.workers[0];
  assert.equal(h.track.clones.length, 1); assert.equal(worker.messages.length, 1);
  await delay(5); assert.equal(worker.messages.length, 1, 'no frame requested without downstream demand');
  const reader = stream.getReader(), pending = reader.read(); await delay(0);
  assert.equal(worker.messages.at(-1).message.type, 'pull');
  const raw = fakeFrame(270, true); worker.emit({ type: 'frame', frame: raw, at: 100025 });
  const { value } = await bounded(pending);
  assert.equal(value.timestamp, 25000); assert.equal(value.rotation, 0); assert.equal(value.flip, false); assert.equal(raw.closes, 1);
  value.close(); await reader.cancel(); assert.equal(worker.terminations, 1); assert.equal(h.track.stops, 0);
});

test('worker cancellation closes late/queued frames and settles pending reads; failures terminate', async () => {
  const h = harness(), stream = await h.worker(h.track), worker = h.workers[0], reader = stream.getReader();
  const pending = reader.read(); await delay(0); await reader.cancel();
  assert.equal((await bounded(pending)).done, true);
  const late = fakeFrame(90); worker.emit({ type: 'frame', frame: late, at: 1 }); assert.equal(late.closes, 1);
  const portWorker = new (class { terminate() { this.terminations = (this.terminations || 0) + 1; } })();
  const port = h.port(portWorker), queued = fakeFrame(); portWorker.onmessage({ data: { type: 'frame', frame: queued } });
  port.close(); port.close(); assert.equal(queued.closes, 1); assert.equal(portWorker.terminations, 1);
  const fail = harness({ contextError: true }), failureStream = await fail.worker(fail.track), failureReader = failureStream.getReader();
  const read = failureReader.read(); await delay(0); const raw = fakeFrame(90);
  fail.workers[0].emit({ type: 'frame', frame: raw, at: 1 });
  await assert.rejects(bounded(read), /2D canvas/); assert.equal(raw.closes, 1); assert.equal(fail.workers[0].terminations, 1);
  const transfer = harness({ postError: new Error('not transferable') });
  assert.equal(await transfer.worker(transfer.track), undefined);
  assert.equal(transfer.track.clones[0].stops, 1); assert.equal(transfer.track.stops, 0);
});

test('fallback waits for decoded dimensions and recovers transient construction errors and readiness loss', async () => {
  const h = harness({ readyState: 1, width: 0, failures: [new DOMException('no frame', 'InvalidStateError')] });
  const reader = h.fallback(h.track).getReader();
  try {
    const pending = reader.read(); await delay(10); assert.equal(h.attempts(), 0);
    h.video.readyState = 2; await delay(10); assert.equal(h.attempts(), 0);
    h.video.videoWidth = 64;
    assert.equal((await bounded(pending)).done, false); assert.ok(h.attempts() >= 2);
    assert.equal(h.video.muted, true); assert.equal(h.video.playsInline, true);
    h.video.readyState = 1; const attempts = h.attempts(); let settled = false;
    const next = reader.read().then(value => { settled = true; return value; });
    await delay(10); assert.equal(settled, false); assert.equal(h.attempts(), attempts);
    h.video.readyState = 2; (await bounded(next)).value.close();
  } finally { await reader.cancel(); }
  const attempts = h.attempts(); await delay(10); assert.equal(h.attempts(), attempts);
  assert.equal(h.video.srcObject, null); assert.equal(h.track.stops, 0);
});

test('fallback cancellation and track end settle pending reads without capturing or busy looping', async () => {
  for (const mode of ['cancel', 'ended-property', 'ended-event']) {
    const h = harness({ readyState: 1 }), reader = h.fallback(h.track).getReader();
    const pending = reader.read(); await delay(5);
    if (mode === 'cancel') await bounded(reader.cancel());
    else { h.track.readyState = 'ended'; if (mode === 'ended-event') h.track.dispatchEvent(new Event('ended')); }
    assert.equal((await bounded(pending)).done, true); assert.equal(h.attempts(), 0);
    assert.equal(h.video.srcObject, null); assert.equal(h.video.pauses, 1); assert.equal(h.track.stops, 0);
  }
});

test('fallback non-transient capture, canvas, draw, and play errors propagate with cleanup', async () => {
  for (const options of [{ failures: [new TypeError('bad input')] }, { playError: new Error('play refused') },
    { contextError: true }, { drawError: new TypeError('draw failed') }]) {
    const h = harness(options), reader = h.fallback(h.track).getReader();
    await assert.rejects(bounded(reader.read()), /bad input|play refused|2D canvas|draw failed/);
    assert.equal(h.video.srcObject, null); assert.equal(h.video.pauses, 1); assert.equal(h.track.stops, 0);
  }
});

test('fallback repeated transient errors remain cancellable and unconsumed streams never allocate frames', async () => {
  const h = harness({ failures: Array.from({ length: 100 }, () => new DOMException('no frame', 'InvalidStateError')) });
  const reader = h.fallback(h.track).getReader(), pending = reader.read();
  await delay(10); assert.ok(h.attempts() > 0 && h.attempts() < 50);
  await bounded(reader.cancel()); assert.equal((await bounded(pending)).done, true);
  const attempts = h.attempts(); await delay(10); assert.equal(h.attempts(), attempts);
  const buffered = harness(), stream = buffered.fallback(buffered.track);
  await delay(20); assert.equal(buffered.attempts(), 0); await stream.cancel();
});

test('fallback cancellation or ended event detaches video while play is pending', async () => {
  for (const end of [false, true]) {
    let rejectPlay; const playPromise = new Promise((_, reject) => { rejectPlay = reject; });
    const h = harness({ playPromise }), reader = h.fallback(h.track).getReader(), pending = reader.read();
    if (end) { h.track.readyState = 'ended'; h.track.dispatchEvent(new Event('ended')); } else await bounded(reader.cancel());
    assert.equal((await bounded(pending)).done, true); assert.equal(h.video.srcObject, null); assert.equal(h.attempts(), 0);
    rejectPlay(new DOMException('play interrupted', 'AbortError')); await delay(5);
  }
});

test('fallback rasterizes live dimensions, reuses canvas, and keeps increasing timestamps', async () => {
  const h = harness({ width: 32 }); h.video.videoHeight = 64; const reader = h.fallback(h.track).getReader();
  try {
    const first = (await bounded(reader.read())).value;
    assert.equal(first.displayWidth, 32); assert.equal(first.displayHeight, 64);
    assert.deepEqual(h.draws[0], [h.video, 0, 0, 32, 64]);
    h.video.videoWidth = 64; h.video.videoHeight = 32;
    const next = (await bounded(reader.read())).value;
    assert.equal(next.displayWidth, 64); assert.equal(next.displayHeight, 32); assert.ok(next.timestamp > first.timestamp);
    assert.equal(h.canvases.length, 1); assert.deepEqual(h.draws.at(-1), [h.video, 0, 0, 64, 32]);
    first.close(); next.close();
  } finally { await reader.cancel(); }
});

test('fallback uses requestVideoFrameCallback captureTime and cancels pending callbacks', async () => {
  const h = harness({ frameRate: 1 }); let callback, requested = 0, cancelled = [];
  h.video.requestVideoFrameCallback = fn => { callback = fn; return ++requested; };
  h.video.cancelVideoFrameCallback = id => cancelled.push(id);
  const reader = h.fallback(h.track).getReader(), pending = reader.read(); await delay(0);
  callback(20, { captureTime: 12.5 }); const frame = (await bounded(pending)).value;
  assert.equal(frame.timestamp, 12500); frame.close();
  const second = reader.read(); await delay(0); await reader.cancel();
  assert.equal((await bounded(second)).done, true); assert.deepEqual(cancelled, [1, 2]);
});

test('fallback ignores stale callbacks and keeps timestamps monotonic across watchdog/captureTime races', async () => {
  const h = harness({ frameRate: 100 }); const callbacks = [];
  h.video.requestVideoFrameCallback = fn => { callbacks.push(fn); return callbacks.length; };
  h.video.cancelVideoFrameCallback = () => {};
  const reader = h.fallback(h.track).getReader();
  const first = (await bounded(reader.read())).value; // Watchdog fallback wins.
  const pending = reader.read(); await delay(0);
  callbacks[0](999, { captureTime: 999 }); // Already-cancelled callback must do nothing.
  callbacks[1](5, { captureTime: 1 });
  const second = (await bounded(pending)).value;
  assert.equal(second.timestamp, first.timestamp + 1);
  first.close(); second.close(); await reader.cancel();
});

test('deferred processor cancellation closes a frame delivered in the read/cancel race', async () => {
  const h = harness(); let deliver, cancel;
  const source = { getReader: () => ({ read: () => new Promise(resolve => { deliver = resolve; }), cancel: async () => { cancel = true; } }) };
  const reader = h.deferred(async () => source).getReader(), pending = reader.read(); await delay(0);
  await reader.cancel(); const raw = fakeFrame(); deliver({ value: raw }); await delay(0);
  assert.equal((await bounded(pending)).done, true); assert.equal(cancel, true); assert.equal(raw.closes, 1);
});
