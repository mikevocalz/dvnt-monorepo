import test from "node:test";
import assert from "node:assert/strict";
import { isWebLivePhoto, resolveWebPostMedia } from "./web-post-media.ts";

test("a Live Photo is a still with a paired clip, whatever the row's type says", () => {
  assert.equal(isWebLivePhoto({ type: "livePhoto", url: "still.jpg", livePhotoVideoUrl: "motion.mov" }), true);
  assert.equal(isWebLivePhoto({ type: "image", url: "still.jpg", livePhotoVideoUrl: "motion.mov" }), true);
  assert.equal(isWebLivePhoto({ type: "livePhoto", url: "still.jpg" }), false, "no clip: an honest still");
  assert.equal(isWebLivePhoto({ type: "livePhoto", url: "still.jpg", livePhotoVideoUrl: "  " }), false);
  assert.equal(isWebLivePhoto({ type: "video", url: "clip.mp4", livePhotoVideoUrl: "motion.mov" }), false);
  assert.equal(isWebLivePhoto({ url: "post-video/a.mov", livePhotoVideoUrl: "motion.mov" }), false);
});

test("Live Photo motion uses its paired clip, never the JPG still", () => {
  assert.deepEqual(resolveWebPostMedia({
    type: "livePhoto", url: "still.jpg", livePhotoVideoUrl: "motion.mov",
  }), { videoUrl: "motion.mov", posterUrl: "still.jpg" });
  assert.equal(resolveWebPostMedia({
    type: "image", url: "still.jpg", livePhotoVideoUrl: "motion.mp4",
  }).videoUrl, "motion.mp4", "a pair survives a legacy image type");
});

test("missing Live Photo pairs stay honest still images", () => {
  for (const type of ["image", "livePhoto"]) {
    assert.deepEqual(resolveWebPostMedia({ type, url: "still.jpg" }), {
      videoUrl: undefined, posterUrl: "still.jpg",
    });
  }
});

test("regular and animated videos resolve motion without an image source", () => {
  for (const type of ["video", "animated_video"]) {
    assert.deepEqual(resolveWebPostMedia({ type, url: "clip.mp4", thumbnail: "poster.jpg" }), {
      videoUrl: "clip.mp4", posterUrl: "poster.jpg",
    });
  }
  assert.equal(resolveWebPostMedia({ type: "image", url: "clip.mov#t=0.1" }).videoUrl, "clip.mov#t=0.1");
  assert.equal(resolveWebPostMedia({ url: "opaque", mimeType: "video/mp4" }).videoUrl, "opaque");
});

test("a video thumbnail is not a valid image poster; gifs retain their source", () => {
  assert.equal(resolveWebPostMedia({ type: "video", url: "clip.mp4", thumbnail: "clip.mp4?thumb=1" }).posterUrl, undefined);
  assert.deepEqual(resolveWebPostMedia({ type: "gif", url: "animation.gif" }), {
    videoUrl: undefined, posterUrl: "animation.gif",
  });
});
