import test from "node:test";
import assert from "node:assert/strict";
import { WebFeedPlayback, type PlaybackState } from "./web-video-playback.ts";
const flush = () => new Promise((resolve) => setImmediate(resolve));
function setup() {
  let state: PlaybackState = { muted: true, blocked: false };
  const video = { muted: false, playing: false, calls: 0, rejects: 0,
    async play() { this.calls++; if (this.rejects-- > 0) throw new Error("NotAllowedError"); this.playing = true; },
    pause() { this.playing = false; },
  };
  const playback = new WebFeedPlayback(video, (next) => { state = next; });
  return { video, playback, state: () => state };
}
test("viewport/background gates play and pause, and remount disposes the old player", async () => {
  const { video, playback } = setup();
  assert.equal(video.calls, 0);
  playback.setActive(true); await flush(); assert.equal(video.playing, true); assert.equal(video.muted, true);
  playback.setActive(false); assert.equal(video.playing, false);
  playback.setActive(true); await flush(); assert.equal(video.playing, true);
  playback.dispose(); assert.equal(video.playing, false);
  playback.setActive(true); await flush(); assert.equal(video.playing, false);
});
test("unmuting transfers sound ownership, never two audible feed videos", async () => {
  const a = setup(), b = setup();
  a.playback.setActive(true); b.playback.setActive(true); await flush();
  a.playback.toggleSound(); assert.equal(a.video.muted, false);
  b.playback.toggleSound(); assert.equal(a.video.muted, true); assert.equal(b.video.muted, false);
  b.playback.setActive(false); assert.equal(b.video.muted, true); assert.equal(b.video.playing, false);
  a.playback.dispose(); b.playback.dispose();
});
test("denied audible playback falls back to muted motion; denied muted playback offers retry", async () => {
  const a = setup(); a.video.rejects = 1;
  a.playback.setActive(true); await flush(); assert.equal(a.state().blocked, true);
  a.playback.play(); await flush(); assert.equal(a.state().blocked, false); assert.equal(a.video.playing, true);
  a.video.rejects = 1; a.playback.toggleSound(); await flush();
  assert.equal(a.video.muted, true); assert.equal(a.video.playing, true); assert.equal(a.state().blocked, false);
  a.playback.dispose();
});
test("late play completion after leaving viewport cannot resurrect playback", async () => {
  let resolve!: () => void;
  const a = setup();
  a.video.play = () => new Promise<void>((r) => { resolve = () => { a.video.playing = true; r(); }; });
  a.playback.setActive(true); a.playback.setActive(false); resolve(); await flush();
  assert.equal(a.video.playing, false); a.playback.dispose();
});
test("late old-source play cannot pause a replacement controller using the same video element", async () => {
  const a = setup();
  let resolve!: () => void;
  const originalPlay = a.video.play.bind(a.video);
  a.video.play = () => new Promise<void>((r) => { resolve = r; });
  a.playback.setActive(true);
  a.playback.dispose();
  a.video.play = originalPlay;
  let replacementState: PlaybackState = { muted: false, blocked: true };
  const replacement = new WebFeedPlayback(a.video, (s) => { replacementState = s; });
  assert.deepEqual(replacementState, { muted: true, blocked: false });
  replacement.setActive(true); await flush();
  resolve(); await flush();
  assert.equal(a.video.playing, true);
  replacement.dispose();
});
