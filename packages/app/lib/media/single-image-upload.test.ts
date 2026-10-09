import test from "node:test";
import assert from "node:assert/strict";
import { uploadSingleImage } from "./single-image-upload.ts";
import { fitImageToCap, scaleToFit, type FitImageDeps } from "./fit-image-to-cap.ts";
import { sizeLimitForKind } from "./upload-policy.ts";

const MB = 1024 * 1024;
const AVATAR_CAP = sizeLimitForKind("avatar");

/**
 * Fake platform: each URI has a byte size and pixel size. Encoding scales the
 * bytes with pixel area and quality, roughly like JPEG does.
 */
function fakePlatform(files: Record<string, { bytes: number; width: number; height: number }>) {
  const encodes: Array<{ resize: { width: number; height: number } | null; quality: number }> = [];
  let n = 0;
  const deps: FitImageDeps = {
    async byteSize(uri) {
      return files[uri]?.bytes ?? null;
    },
    async dimensions(uri) {
      const f = files[uri];
      if (!f) throw new Error("cannot decode");
      return { width: f.width, height: f.height };
    },
    async encode(uri, resize, quality) {
      const src = files[uri];
      if (!src) throw new Error("cannot decode");
      encodes.push({ resize, quality });
      const w = resize?.width ?? src.width;
      const h = resize?.height ?? src.height;
      const out = `blob:encoded-${++n}`;
      // ~0.6 bytes per pixel at q=0.85 for a phone photo.
      files[out] = { bytes: Math.round(w * h * 0.7 * quality), width: w, height: h };
      return out;
    },
  };
  return { deps, encodes, files };
}

/** Stand-in for uploadToServer's preflight: refuses over-cap bytes before any request. */
function fakeServer(files: Record<string, { bytes: number }>) {
  const sent: string[] = [];
  const upload = async (uri: string) => {
    const bytes = files[uri]?.bytes ?? 0;
    if (bytes > AVATAR_CAP) {
      return { success: false, url: "", path: "", filename: "", error: `That file is ${bytes} bytes` };
    }
    sent.push(uri);
    return { success: true, url: `https://cdn.example/${uri}`, path: "", filename: "" };
  };
  return { upload, sent };
}

test("a 4 MB phone photo picked as an avatar reaches the server under the 2 MB cap", async () => {
  // The 2026-10-09 failure: a full-size photo from a file input, no resize,
  // refused by the preflight before any network request.
  const { deps, files } = fakePlatform({ "blob:picked": { bytes: 4 * MB, width: 4032, height: 3024 } });
  const server = fakeServer(files);

  const result = await uploadSingleImage("blob:picked", "avatars", deps, server.upload);

  assert.equal(result.success, true, result.error ?? "");
  assert.equal(server.sent.length, 1);
  assert.notEqual(server.sent[0], "blob:picked");
  assert.ok(files[server.sent[0]].bytes <= AVATAR_CAP);
  assert.ok(Math.max(files[server.sent[0]].width, files[server.sent[0]].height) <= 1440);
});

test("an avatar already under the cap is sent untouched", async () => {
  const { deps, encodes, files } = fakePlatform({ "blob:small": { bytes: 900_000, width: 1080, height: 1080 } });
  const server = fakeServer(files);
  const result = await uploadSingleImage("blob:small", "avatars", deps, server.upload);
  assert.equal(result.success, true);
  assert.deepEqual(server.sent, ["blob:small"]);
  assert.equal(encodes.length, 0);
});

test("an over-cap image the platform cannot decode fails with the real reason, not a generic one", async () => {
  const deps: FitImageDeps = {
    byteSize: async () => 5 * MB,
    dimensions: async () => { throw new Error("HEIC is not supported in this browser"); },
    encode: async () => { throw new Error("unreachable"); },
  };
  let called = false;
  const result = await uploadSingleImage("blob:heic", "avatars", deps, async () => {
    called = true;
    return { success: true, url: "x", path: "", filename: "" };
  });
  assert.equal(result.success, false);
  assert.equal(called, false);
  assert.match(result.error ?? "", /5MB/);
  assert.match(result.error ?? "", /limit is 2MB/);
  assert.match(result.error ?? "", /HEIC is not supported/);
});

test("steps down quality and size until the encode fits, and never upscales", async () => {
  assert.equal(scaleToFit(800, 600, 1440), null);
  assert.deepEqual(scaleToFit(4000, 3000, 1080), { width: 1080, height: 810 });
  assert.deepEqual(scaleToFit(3000, 4000, 720), { width: 540, height: 720 });

  // Dense image: the first encode is still over a 1 MB cap.
  const { deps, encodes } = fakePlatform({ "blob:dense": { bytes: 6 * MB, width: 4000, height: 4000 } });
  const fitted = await fitImageToCap("blob:dense", 1 * MB, deps);
  assert.equal(fitted.ok, true);
  assert.ok(encodes.length > 1);
  assert.equal(encodes[0].resize?.width, 1440);
});

test("reports the smallest size reached when nothing fits", async () => {
  const deps: FitImageDeps = {
    byteSize: async (uri) => (uri === "blob:huge" ? 30 * MB : 3 * MB),
    dimensions: async () => ({ width: 8000, height: 8000 }),
    encode: async () => "blob:out",
  };
  const fitted = await fitImageToCap("blob:huge", AVATAR_CAP, deps);
  assert.equal(fitted.ok, false);
  assert.match(fitted.ok ? "" : fitted.error, /still 3MB after resizing/);
});
