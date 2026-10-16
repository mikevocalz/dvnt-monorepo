const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const patch = readFileSync(path.join(__dirname, '../pnpm-patches/@moq__publish@0.2.14.patch'), 'utf8');
const helper = patch.split('+++ b/video/normalize-orientation.js\n')[1].split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n');
const load = () => import(`data:text/javascript,${encodeURIComponent(helper)}`);
function fakeFrame(rotation = 0, flip = false, overrides = {}) {
  return { rotation, flip, displayWidth: rotation % 180 ? 32 : 64, displayHeight: rotation % 180 ? 64 : 32, timestamp: 123456, duration: 33333, closes: 0, close() { this.closes++; }, ...overrides };
}
test('orientation normalizer owns only replaced frames and reuses its canvas', async () => {
  const { createOrientationNormalizer } = await load();
  const canvases = []; const draws = [];
  global.OffscreenCanvas = class { constructor(width, height) { this.width = width; this.height = height; canvases.push(this); } getContext() { return { clearRect() {}, drawImage: (...args) => draws.push(args) }; } };
  global.VideoFrame = class { constructor(canvas, init) { this.width = canvas.width; this.height = canvas.height; Object.assign(this, init); this.rotation = 0; this.flip = false; } };
  try {
    const normalize = createOrientationNormalizer();
    for (const rotation of [0, 90, 180, 270]) for (const flip of [false, true]) {
      const input = fakeFrame(rotation, flip); const output = normalize(input);
      if (!rotation && !flip) { assert.equal(output, input); assert.equal(input.closes, 0); continue; }
      assert.notEqual(output, input); assert.equal(input.closes, 1);
      assert.equal(output.rotation, 0); assert.equal(output.flip, false);
      assert.equal(output.timestamp, input.timestamp); assert.equal(output.duration, input.duration);
      assert.equal(output.width, input.displayWidth); assert.equal(output.height, input.displayHeight);
    }
    assert.equal(canvases.length, 1); assert.equal(draws.length, 7);
    const cropped = fakeFrame(90, true, { displayWidth: 48, displayHeight: 96, codedWidth: 128, codedHeight: 64, duration: null });
    const output = normalize(cropped); assert.equal(output.width, 48); assert.equal(output.height, 96); assert.equal(output.duration, undefined);
    assert.deepEqual(draws.at(-1).slice(1), [0, 0, 48, 96]);
    const unknown = fakeFrame(0, false, { rotation: undefined, flip: undefined }); assert.equal(normalize(unknown), unknown); assert.equal(unknown.closes, 0);
  } finally { delete global.OffscreenCanvas; delete global.VideoFrame; }
});
test('context/constructor failures close owned input and propagate', async () => {
  const { createOrientationNormalizer } = await load();
  try {
    global.OffscreenCanvas = class { getContext() { return null; } };
    const input = fakeFrame(90); assert.throws(() => createOrientationNormalizer()(input), /2D canvas/); assert.equal(input.closes, 1);
    global.OffscreenCanvas = class { getContext() { return { clearRect() {}, drawImage() {} }; } };
    global.VideoFrame = class { constructor() { throw new Error('allocation'); } };
    const second = fakeFrame(180); assert.throws(() => createOrientationNormalizer()(second), /allocation/); assert.equal(second.closes, 1);
  } finally { delete global.OffscreenCanvas; delete global.VideoFrame; }
});
test('patch normalizes both owned capture boundaries without changing track/audio authority', () => {
  assert.match(patch, /r\.enqueue\(normalizeOrientation\(i\)\)/);
  assert.match(patch, /controller\.enqueue\(normalizeOrientation\(frame\)\)/);
  const additions = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n');
  assert.doesNotMatch(additions, /getUserMedia|\.stop\(|Audio|screen\.orientation|facingMode\s*===/);
  assert.match(additions, /if \(!frame\.rotation && !frame\.flip\) return frame/);
});

test('patch has pnpm-compatible Git file boundaries and exact hunk lengths', () => {
  const files = patch.split(/^diff --git /m).slice(1);
  assert.equal(files.length, 2, 'pnpm requires explicit boundaries between patched files');
  assert.match(files[1], /\nnew file mode 100644\n/);
  for (const file of files) {
    const lines = file.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(lines[i]);
      if (!header) continue;
      let oldCount = 0, newCount = 0;
      for (let j = i + 1; j < lines.length && !lines[j].startsWith('@@'); j++) {
        const line = lines[j];
        if (!line || line.startsWith('\\ No newline')) continue;
        assert.ok(/^[ +\-]/.test(line), 'unexpected line inside patch hunk');
        if (/^[ -]/.test(line)) oldCount++;
        if (/^[ +]/.test(line)) newCount++;
      }
      assert.equal(oldCount, Number(header[2]));
      assert.equal(newCount, Number(header[4]));
    }
  }
});

// Execute the exact patched fallback body, with only browser media objects faked.
function fallbackHarness({ readyState = 2, width = 64, failures = [], playError, normalizeError, playPromise, contextError, drawError } = {}) {
  const postimage = patch.split('diff --git a/video/')[0].split('\n')
    .filter(line => (line.startsWith('+') && !line.startsWith('+++')) || line.startsWith(' '))
    .map(line => line.slice(1)).join('\n');
  const start = postimage.indexOf('\tlet r, i = 0, cancelled');
  const end = postimage.indexOf('\n}', start);
  assert.ok(start > 0 && end > start);
  const body = postimage.slice(start, end);
  const video = { readyState, videoWidth: width, videoHeight: 32, pauses: 0,
    play() { return playPromise ?? (playError ? Promise.reject(playError) : Promise.resolve()); },
    pause() { this.pauses++; } };
  const track = { readyState: 'live' };
  const frames = []; const canvases = []; const draws = []; let attempts = 0;
  const Frame = class { constructor(_video, init) {
    attempts++;
    const failure = failures.shift(); if (failure) throw failure;
    assert.notEqual(_video, video, 'fallback must not extract the opaque sensor frame from video');
    Object.assign(this, init, { width: _video.width, height: _video.height }); frames.push(this);
  } };
  const document = { createElement: name => {
    if (name === 'video') return video;
    assert.equal(name, 'canvas');
    const canvas = { width: 300, height: 150, getContext: () => contextError ? null : {
      clearRect() {}, drawImage: (...args) => { if (drawError) throw drawError; draws.push(args); },
    } };
    canvases.push(canvas); return canvas;
  } };
  const createCapture = new Function('document', 'VideoFrame', helper.replaceAll('export function', 'function') + '\nreturn createVideoElementCapture;')(document, Frame);
  const make = new Function('e', 'n', 't', 'normalizeOrientation', 'document', 'MediaStream', 'VideoFrame', 'createVideoElementCapture', body);
  const stream = make(track, { frameRate: 1000 }, { Milli: { now: () => performance.now(), sub: (a,b) => a-b }, Micro: { fromMilli: n => n*1000 } }, f => { if (normalizeError) throw normalizeError; return f; },
    document, class {}, Frame, createCapture);
  return { stream, video, track, frames, canvases, draws, attempts: () => attempts };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = promise => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error('capture did not settle')), 1000); timer.unref();
})]);
test('fallback waits for current frame and dimensions, then recovers constructor InvalidStateError', async () => {
  const h = fallbackHarness({ readyState: 1, width: 0, failures: [new DOMException('no frame', 'InvalidStateError')] });
  const reader = h.stream.getReader();
  try {
    const pending = reader.read();
    await delay(10); assert.equal(h.attempts(), 0);
    h.video.readyState = 2;
    await delay(10); assert.equal(h.attempts(), 0);
    h.video.videoWidth = 64;
    const first = await bounded(pending);
    assert.equal(first.done, false); assert.ok(h.attempts() >= 2);
    assert.equal(h.video.muted, true); assert.equal(h.video.playsInline, true);
    h.video.readyState = 1;
    const previousAttempts = h.attempts();
    let settled = false;
    const next = reader.read().then(value => { settled = true; return value; });
    await delay(10);
    assert.equal(settled, false); assert.equal(h.attempts(), previousAttempts);
    h.video.readyState = 2;
    assert.equal((await bounded(next)).done, false);
  } finally { await reader.cancel(); }
  const count = h.attempts(); await delay(10);
  assert.equal(h.attempts(), count); assert.equal(h.video.srcObject, null);
  assert.equal(h.track.readyState, 'live', 'capture cleanup must not stop the caller-owned track');
});
test('fallback cancellation and track end settle pending reads without capturing or busy looping', async () => {
  for (const endTrack of [false, true]) {
    const h = fallbackHarness({ readyState: 1 }); const reader = h.stream.getReader();
    const pending = reader.read(); await delay(5);
    if (endTrack) h.track.readyState = 'ended'; else await bounded(reader.cancel());
    assert.equal((await bounded(pending)).done, true);
    assert.equal(h.attempts(), 0); assert.equal(h.video.srcObject, null);
  }
});
test('fallback propagates non-transient capture and play errors with cleanup', async () => {
  for (const config of [{ failures: [new TypeError('bad input')] }, { playError: new Error('play refused') }]) {
    const h = fallbackHarness(config); const reader = h.stream.getReader();
    await assert.rejects(bounded(reader.read()), /bad input|play refused/);
    assert.equal(h.video.srcObject, null); assert.equal(h.video.pauses, 1);
  }
});
test('fallback repeated transient errors remain cancellable and buffering respects backpressure', async () => {
  const h = fallbackHarness({ failures: Array.from({ length: 100 }, () => new DOMException('no frame', 'InvalidStateError')) });
  const reader = h.stream.getReader(); const pending = reader.read();
  await delay(10); assert.ok(h.attempts() > 0 && h.attempts() < 50);
  await bounded(reader.cancel()); assert.equal((await bounded(pending)).done, true);
  const attempts = h.attempts(); await delay(10); assert.equal(h.attempts(), attempts);
  const buffered = fallbackHarness();
  await delay(20); assert.equal(buffered.attempts(), 0, 'unconsumed stream must not allocate an unowned frame');
  await buffered.stream.cancel();
});

test('fallback does not swallow a normalizer InvalidStateError as transient capture failure', async () => {
  const error = new DOMException('normalizer failed', 'InvalidStateError');
  const h = fallbackHarness({ normalizeError: error });
  await assert.rejects(bounded(h.stream.getReader().read()), actual => actual === error);
  assert.equal(h.attempts(), 1); assert.equal(h.video.srcObject, null);
});

test('fallback cancellation detaches video while play startup is pending', async () => {
  let rejectPlay;
  const playPromise = new Promise((_, reject) => { rejectPlay = reject; });
  const h = fallbackHarness({ playPromise });
  const reader = h.stream.getReader(); const pending = reader.read();
  await bounded(reader.cancel());
  assert.equal((await bounded(pending)).done, true);
  assert.equal(h.video.srcObject, null); assert.equal(h.attempts(), 0);
  rejectPlay(new DOMException('play interrupted', 'AbortError'));
  await delay(5);
});

test('fallback rasterizes live video presentation dimensions, reuses canvas, and keeps timestamps', async () => {
  const h = fallbackHarness({ width: 32 }); h.video.videoHeight = 64;
  const reader = h.stream.getReader();
  try {
    const first = (await bounded(reader.read())).value;
    assert.equal(first.width, 32); assert.equal(first.height, 64);
    assert.deepEqual(h.draws[0], [h.video, 0, 0, 32, 64]);
    assert.ok(first.timestamp > 0);
    h.video.videoWidth = 64; h.video.videoHeight = 32;
    const next = (await bounded(reader.read())).value;
    assert.equal(next.width, 64); assert.equal(next.height, 32);
    assert.ok(next.timestamp > first.timestamp);
    assert.equal(h.canvases.length, 1);
    assert.deepEqual(h.draws.at(-1), [h.video, 0, 0, 64, 32]);
  } finally { await reader.cancel(); }
});
test('fallback canvas failure propagates and detaches video without stopping its owner track', async () => {
  for (const config of [{contextError:true}, {drawError:new TypeError('draw failed')}]) {
    const h = fallbackHarness(config);
    await assert.rejects(bounded(h.stream.getReader().read()), /2D canvas|draw failed/);
    assert.equal(h.video.srcObject, null); assert.equal(h.attempts(), 0);
    assert.equal(h.track.readyState, 'live');
  }
});
