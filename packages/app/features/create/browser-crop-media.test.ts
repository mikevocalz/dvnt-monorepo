import test from "node:test";
import assert from "node:assert/strict";
import { applyBrowserCrops } from "./browser-crop-media.ts";
import { applyPhotoPixels, DEFAULT_PHOTO_ADJUSTMENTS, hasPhotoAdjustments } from "./browser-photo-adjustments.ts";
import { canCropMedia } from "../../lib/media/live-photo-original.ts";
import type { MediaAsset } from "../../lib/hooks/use-media-picker";

const first: MediaAsset = { id: "a", type: "image", kind: "image", uri: "blob:a" };
const last: MediaAsset = { ...first, id: "b", uri: "blob:b" };
const live: MediaAsset = { ...first, id: "live", kind: "livePhoto", uri: "blob:still", pairedVideoUri: "blob:motion" };
const gif: MediaAsset = { ...first, id: "gif", kind: "gif", uri: "blob:gif" };
const video: MediaAsset = { ...first, id: "video", type: "video", kind: "video", uri: "blob:video" };

test("mixed browser drafts only crop stills, preserve animated assets byte references and existing slots", () => {
  const selection = [live, first, gif, video, last];
  assert.deepEqual(selection.filter(canCropMedia), [first, last]);
  const croppedLast = { ...last, uri: "data:image/jpeg;base64,AA==" };
  const next = applyBrowserCrops(selection, [croppedLast, first]);
  assert.deepEqual(next, [live, croppedLast, gif, video, first]);
  assert.equal(next[0], live);
  assert.equal(next[0]?.pairedVideoUri, "blob:motion");
  assert.equal(next[2], gif);
  assert.equal(next[3], video);
});

test("crop completion cannot overwrite a different or duplicated current draft", () => {
  assert.throws(() => applyBrowserCrops([first, last], [first, first]), /draft changed/);
  assert.throws(() => applyBrowserCrops([first, last], [first, {...last, id: "replaced"}]), /draft changed/);
  assert.throws(() => applyBrowserCrops([first, live], [live]), /draft changed/);
});

test("neutral adjustments leave every pixel byte-identical", () => {
  const data = new Uint8ClampedArray([231, 51, 80, 163, 60, 70, 80, 255]);
  const original = data.slice();
  assert.equal(hasPhotoAdjustments(DEFAULT_PHOTO_ADJUSTMENTS), false);
  applyPhotoPixels(data, 2, 1, DEFAULT_PHOTO_ADJUSTMENTS);
  assert.deepEqual(data, original);
});

test("light and color alter RGB, retain alpha and clip out-of-range values", () => {
  const data = new Uint8ClampedArray([240, 70, 20, 163]);
  applyPhotoPixels(data, 1, 1, { ...DEFAULT_PHOTO_ADJUSTMENTS, light: 500, color: 50 });
  assert.deepEqual([...data], [255, 81, 0, 163]);
});

test("Mono converts to grayscale and Warm boosts red proportionally to blue", () => {
  const mono = new Uint8ClampedArray([150, 90, 30, 255]);
  applyPhotoPixels(mono, 1, 1, { ...DEFAULT_PHOTO_ADJUSTMENTS, filter: "mono" });
  assert.equal(mono[0], mono[1]);
  assert.equal(mono[1], mono[2]);
  const warm = new Uint8ClampedArray([120, 120, 120, 255]);
  applyPhotoPixels(warm, 1, 1, { ...DEFAULT_PHOTO_ADJUSTMENTS, filter: "warm" });
  assert.ok(warm[0] > 120 && warm[2] < 120);
});

test("sharpening is symmetric, preserves alpha, and does not feed changed pixels back into the convolution", () => {
  const data = new Uint8ClampedArray(5 * 5 * 4);
  for (let i = 0; i < 25; i++) data.set([100, 100, 100, 200], i * 4);
  data.set([140, 140, 140, 190], 12 * 4);
  applyPhotoPixels(data, 5, 5, { ...DEFAULT_PHOTO_ADJUSTMENTS, sharpness: 100 });
  assert.equal(data[12 * 4], 180);
  for (const i of [7, 11, 13, 17]) assert.equal(data[i * 4], 90);
  assert.equal(data[12 * 4 + 3], 190);
  assert.equal(data[0], 100);
});
