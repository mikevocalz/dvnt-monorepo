import test from "node:test";
import assert from "node:assert/strict";
import { uploadLivePhotoPair } from "./live-photo-upload.ts";
const file = { uri: "original.heic", pairedVideoUri: "original.mov", mimeType: "image/heic" };
test("both original assets must upload before publishing success", async () => {
  const calls: string[] = [];
  const result = await uploadLivePhotoPair(file, async (uri) => {
    calls.push(uri); return { success: true, url: `https://cdn/${uri}` };
  });
  assert.deepEqual(calls, [file.uri, file.pairedVideoUri]);
  if (!result.success) assert.fail(result.error);
  assert.equal(result.url, "https://cdn/original.heic");
  assert.equal(result.livePhotoVideoUrl, "https://cdn/original.mov");
});
test("missing pair, failed/empty still or failed/empty video never reports a publishable image", async () => {
  for (const stage of ["missing", "still", "video", "empty-still", "empty-video", "throw"]) {
    let calls = 0;
    const result = await uploadLivePhotoPair(stage === "missing" ? { uri: file.uri } : file, async (uri) => {
      calls++;
      if (stage === "throw") throw new Error("offline");
      const fails = (stage.endsWith("still") && uri === file.uri) || (stage.endsWith("video") && uri === file.pairedVideoUri);
      return { success: !fails || stage.startsWith("empty"), url: fails ? "" : `https://cdn/${uri}` };
    });
    if (result.success) assert.fail(`Unexpected success: ${stage}`);
    assert.equal(result.url, "", stage);
    assert.ok(result.error, stage);
    if (stage === "missing") assert.equal(calls, 0);
    if (stage.endsWith("still")) assert.equal(calls, 1);
  }
});
