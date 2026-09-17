/**
 * A container is not a suggestion.
 *
 * Native uploads used to be recorded as `video/mp4` unconditionally
 * (use-media-upload.ts) and the dead helper hard-coded `mime: "video/mp4"`
 * even on the branch that returned the untouched original. Production has 43
 * rows stored as `video/quicktime`, so the rename was not even consistent —
 * it depended on which branch ran.
 *
 * Mirrors `uploadMimeForVideo` in use-media-upload.ts and `getExtension` in
 * server-upload.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";

function uploadMimeForVideo(
  sourceUri: string,
  sourceMime: string | undefined,
  reencoded: boolean | undefined,
): string {
  if (reencoded) return "video/mp4";
  if (sourceMime) return sourceMime;
  return /\.mov(?:[?#]|$)/i.test(sourceUri) ? "video/quicktime" : "video/mp4";
}

test("an untouched QuickTime file is not relabelled as mp4", () => {
  assert.equal(
    uploadMimeForVideo("file:///tmp/IMG_0001.mov", "video/quicktime", false),
    "video/quicktime",
  );
});

test("a .mov with no reported mime is still quicktime", () => {
  assert.equal(
    uploadMimeForVideo("file:///tmp/IMG_0001.mov", undefined, false),
    "video/quicktime",
  );
});

test("only an actual re-encode may claim mp4", () => {
  assert.equal(
    uploadMimeForVideo("file:///tmp/IMG_0001.mov", "video/quicktime", true),
    "video/mp4",
  );
});

test("an mp4 source stays mp4 either way", () => {
  assert.equal(
    uploadMimeForVideo("file:///tmp/clip.mp4", "video/mp4", false),
    "video/mp4",
  );
  assert.equal(uploadMimeForVideo("file:///tmp/clip.mp4", undefined, false), "video/mp4");
});

test("HEVC in an mp4 container is not converted on the way out", () => {
  // The source mime is carried through verbatim: nothing in the original path
  // inspects the codec, so an HEVC/H.265 file is stored as the member shot it.
  assert.equal(
    uploadMimeForVideo("file:///tmp/hevc.mp4", "video/mp4", false),
    "video/mp4",
  );
});
