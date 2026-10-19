import assert from "node:assert/strict";
import { test } from "node:test";
import { canCropMedia, publishMediaFile } from "./live-photo-original.ts";

const pair = { type: "image" as const, kind: "livePhoto", uri: "file:///original.heic", mimeType: "image/heic", pairedVideoUri: "file:///original.mov" };

test("bitmap crop eligibility excludes Live Photos, GIFs and video", () => {
  assert.equal(canCropMedia(pair), false);
  assert.equal(canCropMedia({ ...pair, kind: "image" }), false);
  assert.equal(canCropMedia({ type: "image", kind: "gif", uri: "file:///animated.gif" }), false);
  assert.equal(canCropMedia({ type: "video", kind: "video", uri: "file:///clip.mov" }), false);
  assert.equal(canCropMedia({ type: "image", kind: "image", uri: "file:///still.jpg" }), true);
});
test("untouched picker pair retains original URIs and order", () => {
  assert.deepEqual(publishMediaFile(pair), pair);
  const files = [pair, { ...pair, uri: "file:///second.heic", pairedVideoUri: "file:///second.mov" }].map(publishMediaFile);
  assert.deepEqual(files.map(f => f.pairedVideoUri), ["file:///original.mov", "file:///second.mov"]);
});
test("legacy cropped drafts publish original still, never JPEG derivative", () => {
  const edited = { ...pair, uri: "file:///crop.jpg", originalUri: pair.uri, editedUri: "file:///crop.jpg", editorOpened: true };
  assert.deepEqual(publishMediaFile(edited), pair);
  assert.deepEqual(publishMediaFile({ ...edited, kind: "image" }), pair);
});
test("damaged legacy draft is rejected rather than falsely preserving pairing", () => {
  assert.throws(() => publishMediaFile({ ...pair, uri: "file:///crop.jpg", editedUri: "file:///crop.jpg", editorOpened: true }), /original Live Photo is missing/);
});
test("ordinary still explicitly cropped retains its chosen edit", () => {
  const edited = { type: "image" as const, kind: "image", uri: "file:///original.jpg", editedUri: "file:///crop.jpg", editorOpened: true };
  assert.equal(publishMediaFile(edited).uri, edited.editedUri);
});
