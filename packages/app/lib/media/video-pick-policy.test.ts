/**
 * Post video limits are checked when the member picks the file, using the same
 * numbers media-upload enforces. Before this, a webm or a 30MB post video
 * uploaded in full and then failed with the server's raw string.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import {
  ALLOWED_VIDEO_MIMES,
  MAX_VIDEO_DURATION_SEC,
  sizeLimitForKind,
} from "./upload-policy.ts";
import {
  friendlyUploadError,
  validateVideoPick,
  videoLimitsLabel,
} from "./video-pick-policy.ts";

const MB = 1024 * 1024;
const serverSource = readFileSync(
  new URL("../../../../apps/mobile/supabase/functions/media-upload/index.ts", import.meta.url),
  "utf8",
);

test("video mimes and duration match media-upload", () => {
  const mimeBlock = serverSource.split("const ALLOWED_VIDEO_MIMES =")[1].split(";")[0];
  const serverMimes = [...mimeBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...ALLOWED_VIDEO_MIMES], serverMimes);
  const duration = Number(/const MAX_VIDEO_DURATION_SEC = (\d+);/.exec(serverSource)?.[1]);
  assert.equal(MAX_VIDEO_DURATION_SEC, duration);
});

test("an MP4 or MOV inside the post limits is accepted", () => {
  assert.deepEqual(
    validateVideoPick({ kind: "post-video", mimeType: "video/mp4", sizeBytes: 10 * MB, durationSec: 30 }),
    { ok: true },
  );
  assert.equal(
    validateVideoPick({ kind: "post-video", mimeType: "video/quicktime", sizeBytes: 25 * MB, durationSec: 60 }).ok,
    true,
  );
});

test("a webm is refused at pick time with the formats named", () => {
  const result = validateVideoPick({ kind: "post-video", mimeType: "video/webm", sizeBytes: MB, durationSec: 5 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "format");
  assert.match(result.message, /MP4 or MOV/);
});

test("the type is read from the file name when the browser gives none", () => {
  assert.equal(validateVideoPick({ kind: "post-video", mimeType: "", fileName: "clip.MOV", sizeBytes: MB }).ok, true);
  const webm = validateVideoPick({ kind: "post-video", mimeType: "", fileName: "clip.webm", sizeBytes: MB });
  assert.equal(webm.ok, false);
});

test("an unreadable type is refused unless the caller lets the server decide", () => {
  assert.equal(validateVideoPick({ kind: "post-video", sizeBytes: MB }).ok, false);
  assert.equal(validateVideoPick({ kind: "post-video", sizeBytes: MB, unknownFormat: "allow" }).ok, true);
});

test("a 30MB post video is refused and the message names 25MB", () => {
  const result = validateVideoPick({ kind: "post-video", mimeType: "video/mp4", sizeBytes: 30 * MB, durationSec: 20 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "size");
  assert.match(result.message, /30MB/);
  assert.match(result.message, /25MB/);
});

test("size is not a pick-time refusal where the device can re-encode to fit", () => {
  const result = validateVideoPick({
    kind: "post-video", mimeType: "video/mp4", sizeBytes: 80 * MB, durationSec: 20, canReencode: true,
  });
  assert.equal(result.ok, true);
});

test("61 seconds is refused, 60.2 passes, unknown length is the server's call", () => {
  const long = validateVideoPick({ kind: "post-video", mimeType: "video/mp4", sizeBytes: MB, durationSec: 61 });
  assert.equal(long.ok, false);
  if (!long.ok) {
    assert.equal(long.reason, "duration");
    assert.match(long.message, /60s/);
  }
  assert.equal(validateVideoPick({ kind: "post-video", mimeType: "video/mp4", sizeBytes: MB, durationSec: 60.2 }).ok, true);
  assert.equal(validateVideoPick({ kind: "post-video", mimeType: "video/mp4", sizeBytes: MB, durationSec: null }).ok, true);
});

test("the composer label states the post limits", () => {
  assert.equal(videoLimitsLabel("post-video"), "Video up to 60s, 25MB, MP4 or MOV");
  assert.equal(sizeLimitForKind("post-video"), 25 * MB);
});

test("raw media-upload errors become plain copy", () => {
  assert.equal(
    friendlyUploadError("Invalid mime type for post-video: video/webm. Allowed: video/mp4, video/quicktime, video/mov"),
    "That video format can't be posted. Use MP4 or MOV.",
  );
  assert.equal(
    friendlyUploadError("File too large for post-video: 30.12MB exceeds 25.0MB limit"),
    "That video is 30MB. Post videos can be up to 25MB.",
  );
  assert.equal(
    friendlyUploadError("Video too long: 75s exceeds 60s limit"),
    "That video is 75s long. Videos can be up to 60s.",
  );
  assert.equal(
    friendlyUploadError("Video rejected: Duration 75s exceeds 60s limit"),
    "That video is 75s long. Videos can be up to 60s.",
  );
  assert.equal(
    friendlyUploadError("File too large for post-image: 12.00MB exceeds 10.0MB limit"),
    "That photo is 12MB. Post photos can be up to 10MB.",
  );
});

test("copy that is already readable passes through untouched", () => {
  const copy = "Upload timed out. Check your connection and try again.";
  assert.equal(friendlyUploadError(copy), copy);
  assert.equal(friendlyUploadError(""), "Media upload failed. Try again.");
  assert.equal(friendlyUploadError(undefined), "Media upload failed. Try again.");
});
