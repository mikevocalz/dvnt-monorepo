import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_VIDEO_INPUT_MAX_BYTES,
  eventVideoEncodePlan,
  validatePreparedEventVideo,
  type EventVideoMetadata,
} from "./event-video-preparation.ts";
import { sizeLimitForKind } from "./upload-policy.ts";

const MB = 1024 * 1024;
const source: EventVideoMetadata = { width: 1080, height: 1920, durationSec: 30,
  fps: 30, frameCount: 900, audioTrackCount: 1 };

test("111MB input is prepared toward the unchanged 50MB upload cap at source resolution", () => {
  const plan = eventVideoEncodePlan(111 * MB, source);
  assert.equal(sizeLimitForKind("event-video"), 50 * MB);
  assert.equal(EVENT_VIDEO_INPUT_MAX_BYTES, 150 * MB);
  assert.equal(plan.action, "encode");
  assert.equal(plan.maxLongEdge, 1920);
  assert.ok(plan.videoBitrateBps! > 10_000_000);
  assert.ok((plan.videoBitrateBps! + 128_000) * 30 / 8 < 50 * MB);
});

test("150MB input is accepted, input over 150MB is rejected before encoding", () => {
  assert.equal(eventVideoEncodePlan(150 * MB, source).action, "encode");
  assert.throws(() => eventVideoEncodePlan(150 * MB + 1, source), /150MB/);
});

test("60 second clips fit but longer and unmeasured clips are refused", () => {
  assert.equal(eventVideoEncodePlan(111 * MB, { ...source, durationSec: 60, frameCount: 1800 }).action, "encode");
  assert.throws(() => eventVideoEncodePlan(111 * MB, { ...source, durationSec: 61 }), /60 seconds/);
  for (const value of [0, NaN, Infinity]) {
    assert.throws(() => eventVideoEncodePlan(111 * MB, { ...source, width: value }), /timing and resolution/);
  }
});

test("quality floor refuses destructive high-resolution compression", () => {
  assert.throws(() => eventVideoEncodePlan(111 * MB,
    { ...source, width: 2160, height: 3840, durationSec: 60, fps: 60, frameCount: 3600 }), /reducing detail/);
});

test("verified copy must fit and preserve dimensions, duration, every frame and audio tracks", () => {
  assert.doesNotThrow(() => validatePreparedEventVideo(45 * MB, source, source));
  assert.doesNotThrow(() => validatePreparedEventVideo(50 * MB, source, source));
  for (const bytes of [0, NaN, 50 * MB + 1]) {
    assert.throws(() => validatePreparedEventVideo(bytes, source, source), /50MB/);
  }
  assert.throws(() => validatePreparedEventVideo(45 * MB, source, { ...source, width: 720, height: 1280 }), /resolution/);
  assert.throws(() => validatePreparedEventVideo(45 * MB, source, { ...source, frameCount: 899 }), /complete video and audio/);
  assert.throws(() => validatePreparedEventVideo(45 * MB, source, { ...source, audioTrackCount: 0 }), /complete video and audio/);
  assert.throws(() => validatePreparedEventVideo(45 * MB, source, { ...source, durationSec: 20 }), /complete video and audio/);
});
