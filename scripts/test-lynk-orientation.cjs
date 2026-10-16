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
    const unknown = fakeFrame(undefined, undefined); assert.equal(normalize(unknown), unknown); assert.equal(unknown.closes, 0);
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
  assert.match(patch, /normalizeOrientation\(new VideoFrame\(r,/);
  const additions = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n');
  assert.doesNotMatch(additions, /getUserMedia|\.stop\(|Audio|screen\.orientation|facingMode\s*===/);
  assert.match(additions, /if \(!frame\.rotation && !frame\.flip\) return frame/);
});
