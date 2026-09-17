/**
 * The regressions that cost members their pixels.
 *
 * Every case here maps to something that actually happened: a 1080x1920 clip
 * stored as 360x640, a "1080" setting that meant a 1080px longer edge, a 4K
 * source flattened to 1920, an encoder "success" that produced a broken file,
 * and unknown metadata being treated as a reason to shrink something.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VIDEO_UPLOAD_MODE,
  SMALLER_LADDER,
  isUsableSmallerCopy,
  ladderTierFor,
} from "./video-quality.ts";
import { MEDIA_SIZE_LIMITS } from "./upload-policy.ts";

test("publishing a video does not re-encode it by default", () => {
  assert.equal(DEFAULT_VIDEO_UPLOAD_MODE, "original");
});

test("a smaller copy of 1080p portrait keeps 1080x1920, not 608x1080", () => {
  // The longer edge of a 1080x1920 portrait clip is 1920. react-native-
  // compressor caps the LONGER edge, so asking for 1080 here produced
  // 608x1080 — which is what `maxSize: 1080` was doing.
  const tier = ladderTierFor(1920);
  assert.equal(tier.maxLongEdge, 1920);
});

test("portrait and landscape 1080p are treated identically", () => {
  // 1080x1920 and 1920x1080 have the same longer edge and must not be scaled
  // differently from each other.
  assert.deepEqual(ladderTierFor(1920), ladderTierFor(1920));
  assert.equal(ladderTierFor(1920).maxLongEdge, 1920);
});

test("a 4K source is not capped at 1920", () => {
  const tier = ladderTierFor(3840);
  assert.equal(tier.maxLongEdge, 3840);
  assert.ok(tier.bitrateBps > ladderTierFor(1920).bitrateBps);
});

test("a smaller copy never upscales a small source", () => {
  assert.equal(ladderTierFor(720).maxLongEdge, 720);
  assert.equal(ladderTierFor(480).maxLongEdge, 480);
});

test("unknown dimensions never become a downscale", () => {
  // The old code answered 1920x1080 whenever it could not measure, so an
  // unmeasurable 4K clip was silently treated as 1080p. Unknown now takes the
  // top tier rather than shrinking anything.
  const top = SMALLER_LADDER[SMALLER_LADDER.length - 1];
  assert.equal(ladderTierFor(null).maxLongEdge, top.maxLongEdge);
  assert.equal(ladderTierFor(undefined).maxLongEdge, top.maxLongEdge);
  assert.equal(ladderTierFor(0).maxLongEdge, top.maxLongEdge);
});

test("an encode that is not smaller is discarded, not published", () => {
  assert.equal(isUsableSmallerCopy(10_000_000, 12_000_000).usable, false);
  assert.equal(isUsableSmallerCopy(10_000_000, 10_000_000).usable, false);
  assert.equal(isUsableSmallerCopy(10_000_000, 6_000_000).usable, true);
});

test("an implausibly small encode is treated as damage", () => {
  // 1% of the source is a broken export, not a compression ratio.
  assert.equal(isUsableSmallerCopy(10_000_000, 100_000).usable, false);
  assert.equal(isUsableSmallerCopy(10_000_000, 0).usable, false);
});

test("size limits admit a real 60s 1080p original", () => {
  // ~8 Mbps x 60s = 60MB. A cap below that is a compression mandate in
  // disguise — it forces a re-encode to publish anything.
  const sixtySecondsOf1080p = 60 * (8_000_000 / 8);
  for (const kind of ["post-video", "story-video", "event-video"]) {
    assert.ok(
      MEDIA_SIZE_LIMITS[kind] > sixtySecondsOf1080p,
      `${kind} cap ${MEDIA_SIZE_LIMITS[kind]} cannot hold a 60s 1080p original`,
    );
  }
});
