// Regression guard for the mobile-web story video controls.
// The portrait player frame is vertically centered and may begin at y=0 on
// short devices. Close and sound must share an OUTER safe-area origin.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = readFileSync(join(__dirname, 'story-viewer-overlay.web.tsx'), 'utf8');

test('mobile web story sound and close have non-overlapping 44px targets', () => {
  const close = source.indexOf('aria-label="Close story"');
  const sound = source.indexOf('aria-label={muted ? "Unmute story" : "Mute story"}');
  const frameEnd = source.indexOf('<StoryViewersSheetWeb');
  assert.ok(close >= 0 && sound > close && frameEnd > close);
  assert.ok(sound > frameEnd, 'sound must be outside the portrait media frame');
  const closeMarkup = source.slice(close, close + 380);
  const soundMarkup = source.slice(sound, sound + 420);
  assert.match(closeMarkup, /w-11 h-11/);
  assert.match(closeMarkup, /safe-area-inset-top\) \+ 12px/);
  assert.match(soundMarkup, /safe-area-inset-top\) \+ 68px/);
  assert.match(soundMarkup, /h-11 w-11/);
  // Same safe area offset cancels out: 68 - (12 + 44) = 12px gap.
  assert.equal(68 - (12 + 44), 12);
});
