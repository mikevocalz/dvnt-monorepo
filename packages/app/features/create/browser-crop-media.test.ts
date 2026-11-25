import test from "node:test";
import assert from "node:assert/strict";
import { applyBrowserCrops } from "./browser-crop-media.ts";
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
