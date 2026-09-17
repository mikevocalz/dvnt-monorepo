/**
 * The two requirements, held together: small files AND visible detail.
 *
 * Every case maps to something that happened or must never happen — a
 * 1080x1920 clip stored as 360x640, a budget met by destroying resolution, an
 * unmeasurable file being shrunk on a guess, or an encoder "success" that
 * produced something unusable.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_BITRATE_BPS,
  MIN_BITS_PER_PIXEL,
  bitsPerPixel,
  isUsablePreparedCopy,
  planVideoUpload,
} from "./video-quality.ts";
import { MEDIA_SIZE_LIMITS } from "./upload-policy.ts";

const POST = MEDIA_SIZE_LIMITS["post-video"];
const STORY = MEDIA_SIZE_LIMITS["story-video"];

test("a clip already within budget is never re-encoded", () => {
  const plan = planVideoUpload({
    sizeBytes: 4 * 1024 * 1024,
    budgetBytes: POST,
    durationSec: 20,
    width: 1080,
    height: 1920,
    fps: 30,
  });
  assert.equal(plan.action, "passthrough");
});

test("an over-budget 1080p clip is encoded at its own dimensions, not shrunk", () => {
  const plan = planVideoUpload({
    sizeBytes: 90 * 1024 * 1024,
    budgetBytes: POST,
    durationSec: 30,
    width: 1080,
    height: 1920,
    fps: 30,
  });
  assert.equal(plan.action, "encode");
  // The longer edge handed to the encoder is the source's own — the 640 and
  // 1080 caps that produced 360x640 and 608x1080 are both gone.
  assert.equal(plan.maxLongEdge, 1920);
  assert.notEqual(plan.maxLongEdge, 640);
  assert.ok(plan.videoBitrateBps && plan.videoBitrateBps > 0);
});

test("the encode stays inside the budget once audio and container are paid for", () => {
  const durationSec = 30;
  const plan = planVideoUpload({
    sizeBytes: 90 * 1024 * 1024,
    budgetBytes: POST,
    durationSec,
    width: 1080,
    height: 1920,
    fps: 30,
  });
  assert.equal(plan.action, "encode");
  const totalBits =
    (plan.videoBitrateBps! + AUDIO_BITRATE_BPS) * durationSec * 1.02;
  assert.ok(
    totalBits / 8 <= POST,
    `planned ${(totalBits / 8 / 1048576).toFixed(1)}MB exceeds the ${(POST / 1048576).toFixed(0)}MB budget`,
  );
});

test("portrait and landscape 1080p get the same treatment", () => {
  const args = {
    sizeBytes: 90 * 1024 * 1024,
    budgetBytes: POST,
    durationSec: 30,
    fps: 30,
  };
  const portrait = planVideoUpload({ ...args, width: 1080, height: 1920 });
  const landscape = planVideoUpload({ ...args, width: 1920, height: 1080 });
  assert.equal(portrait.maxLongEdge, landscape.maxLongEdge);
  assert.equal(portrait.videoBitrateBps, landscape.videoBitrateBps);
});

test("a 4K clip that cannot hold the quality floor is reported, not ruined", () => {
  const plan = planVideoUpload({
    sizeBytes: 400 * 1024 * 1024,
    budgetBytes: STORY,
    durationSec: 60,
    width: 2160,
    height: 3840,
    fps: 60,
  });
  assert.equal(plan.action, "too_large");
  assert.ok(
    plan.fittingDurationSec !== undefined && plan.fittingDurationSec >= 0,
    "must say how much WOULD fit so the member can trim",
  );
});

test("the quality floor is what makes a clip too large, not the size alone", () => {
  // Same 4K frame, short enough that the budget affords the floor.
  const plan = planVideoUpload({
    sizeBytes: 200 * 1024 * 1024,
    budgetBytes: 25 * 1024 * 1024,
    durationSec: 6,
    width: 2160,
    height: 3840,
    fps: 30,
  });
  assert.equal(plan.action, "encode");
  assert.ok(plan.bitsPerPixel! >= MIN_BITS_PER_PIXEL);
  assert.equal(plan.maxLongEdge, 3840);
});

test("unmeasurable metadata never triggers a downscale", () => {
  for (const missing of [
    { durationSec: null, width: 1080, height: 1920 },
    { durationSec: 30, width: null, height: 1920 },
    { durationSec: 30, width: 1080, height: null },
  ]) {
    const plan = planVideoUpload({
      sizeBytes: 90 * 1024 * 1024,
      budgetBytes: POST,
      fps: null,
      ...missing,
    });
    assert.equal(plan.action, "passthrough");
  }
});

test("bits per pixel is computed, not asserted", () => {
  assert.equal(bitsPerPixel(6_220_800, 1080, 1920, 30), 0.1);
  assert.equal(bitsPerPixel(0, 1080, 1920, 30), 0);
});

test("a prepared copy is rejected when it is bigger, over budget or damaged", () => {
  assert.equal(isUsablePreparedCopy(50e6, 60e6, POST).usable, false);
  assert.equal(isUsablePreparedCopy(50e6, 30e6, POST).usable, false); // over 25MiB
  assert.equal(isUsablePreparedCopy(50e6, 500e3, POST).usable, false); // 1% = damage
  assert.equal(isUsablePreparedCopy(50e6, 20e6, POST).usable, true);
});

test("client budgets are the small ones, not a raised cap", () => {
  assert.equal(MEDIA_SIZE_LIMITS["story-video"], 18 * 1024 * 1024);
  assert.equal(MEDIA_SIZE_LIMITS["post-video"], 25 * 1024 * 1024);
  assert.equal(MEDIA_SIZE_LIMITS["message-video"], 12 * 1024 * 1024);
});
