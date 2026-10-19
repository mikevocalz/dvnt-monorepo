import test from "node:test";
import type { MediaAsset } from "../../lib/hooks/use-media-picker";
import assert from "node:assert/strict";
import { createBrowserLivePhotoAsset, validateLivePhotoFiles, captureBrowserMediaCommit, releaseBrowserMediaAsset } from "./browser-live-photo-import.ts";
import { sizeLimitForKind, MAX_VIDEO_DURATION_SEC } from "../../lib/media/upload-policy.ts";

const still = (name = "same-name.jpg", type = "image/jpeg") => new File([new Uint8Array([255, 216, 255, 219, 1, 2, 3])], name, { type });
const motion = (name = "completely-different-name.mov", type = "video/quicktime") => new File([new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 113, 116])], name, { type });
const options = { readDuration: async () => 2.5 };

test("explicit browser pairing preserves both original File byte streams, not a fabricated animation", async () => {
  const image = still(); const video = motion();
  const result = await createBrowserLivePhotoAsset(image, video, options);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { asset } = result;
  try {
    assert.equal(asset.kind, "livePhoto"); assert.equal(asset.type, "image");
    assert.equal(asset.fileName, image.name); assert.equal(asset.duration, 2.5);
    assert.equal(asset.originalUri, asset.uri);
    assert.deepEqual(await (await fetch(asset.uri)).arrayBuffer(), await image.arrayBuffer());
    assert.deepEqual(await (await fetch(asset.pairedVideoUri!)).arrayBuffer(), await video.arrayBuffer());
    assert.equal((await fetch(asset.pairedVideoUri!)).headers.get("content-type"), "video/quicktime");
    assert.notEqual(asset.pairedVideoUri, asset.uri);
  } finally { releaseBrowserMediaAsset(asset); }
});

test("unknown OS MIME is inferred per explicitly picked file without renaming or altering bytes", async () => {
  const result = await createBrowserLivePhotoAsset(still("original.HEIC", ""), motion("original.MOV", ""), options);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  try {
    assert.equal((await fetch(result.asset.uri)).headers.get("content-type"), "image/heic");
    assert.equal((await fetch(result.asset.pairedVideoUri!)).headers.get("content-type"), "video/quicktime");
    assert.deepEqual(await (await fetch(result.asset.uri)).arrayBuffer(), await still("original.HEIC", "").arrayBuffer());
  } finally { releaseBrowserMediaAsset(result.asset); }
});

test("same filenames never replace, deduplicate, or associate independently chosen pairs", async () => {
  const a = await createBrowserLivePhotoAsset(still(), motion(), options);
  const b = await createBrowserLivePhotoAsset(still(), motion(), options);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.asset.id, b.asset.id); assert.notEqual(a.asset.uri, b.asset.uri);
  releaseBrowserMediaAsset(a.asset); releaseBrowserMediaAsset(b.asset);
});

test("missing halves, animated stills, unsupported containers, HEIF, and empty files are refused", () => {
  assert.ok(validateLivePhotoFiles(still(), null)); assert.ok(validateLivePhotoFiles(null, motion()));
  assert.ok(validateLivePhotoFiles(still("still.gif", "image/gif"), motion()));
  assert.ok(validateLivePhotoFiles(still("still.heif", "image/heif"), motion()));
  assert.ok(validateLivePhotoFiles(still("still.jpg", "video/mp4"), motion()));
  assert.ok(validateLivePhotoFiles(still(), motion("motion.webm", "video/webm")));
  assert.ok(validateLivePhotoFiles(still(), new File([], "empty.mov", { type: "video/quicktime" })));
});

test("byte and duration ceilings use the existing upload policy; undecodable motion is not publishable", async () => {
  const tooBigStill = new File([new Uint8Array(sizeLimitForKind("post-image") + 1)], "big.jpg", { type: "image/jpeg" });
  const tooBigMotion = new File([new Uint8Array(sizeLimitForKind("post-video") + 1)], "big.mp4", { type: "video/mp4" });
  assert.match(validateLivePhotoFiles(tooBigStill, motion())!.message, /10MB/);
  assert.match(validateLivePhotoFiles(still(), tooBigMotion)!.message, /25MB/);
  for (const duration of [null, NaN, Infinity, 0, -2, MAX_VIDEO_DURATION_SEC + 1]) {
    const result = await createBrowserLivePhotoAsset(still(), motion(), { readDuration: async () => duration });
    assert.equal(result.ok, false, `duration ${duration} must fail`);
  }
});

test("failure creating motion URL releases only the temporary still URL", async () => {
  const revoked: string[] = [];
  let count = 0;
  await assert.rejects(createBrowserLivePhotoAsset(still(), motion(), {
    ...options,
    createObjectURL: () => { if (++count === 2) throw new Error("no URL"); return "blob:temporary-still"; },
    revokeObjectURL: url => revoked.push(url),
  }));
  assert.deepEqual(revoked, ["blob:temporary-still"]);
});

const asset = (id: string) => ({ id, uri: `blob:${id}`, pairedVideoUri: `blob:${id}-motion`, type: "image" as const, kind: "livePhoto" as const });
function draft() {
  let state = { selectedMedia: [asset("first")] as MediaAsset[], postKind: "media", textSlides: [{}], setSelectedMedia: (media: MediaAsset[]) => { state = { ...state, selectedMedia: media }; } };
  return { get: () => state, change: (patch: Partial<typeof state>) => { state = { ...state, ...patch }; } };
}
test("commit retains indivisible pair order, supports repeat adds, and refuses a cap overflow", () => {
  const d = draft();
  assert.equal(captureBrowserMediaCommit(d.get)([asset("second")]), true);
  assert.deepEqual(d.get().selectedMedia.map(a => a.id), ["first", "second"]);
  assert.equal(d.get().selectedMedia[1].pairedVideoUri, "blob:second-motion");
  d.change({ selectedMedia: Array.from({ length: 9 }, (_, i) => asset(String(i))) });
  assert.equal(captureBrowserMediaCommit(d.get)([asset("tenth")]), true);
  assert.equal(captureBrowserMediaCommit(d.get)([asset("eleventh")]), false);
  assert.equal(d.get().selectedMedia.length, 10);
});

test("async results cannot append after reset, reorder, remove, another add, mode switch, or cancellation", () => {
  const mutations = [
    (d: ReturnType<typeof draft>) => d.change({ textSlides: [{}] }),
    (d: ReturnType<typeof draft>) => d.change({ selectedMedia: [...d.get().selectedMedia].reverse() }),
    (d: ReturnType<typeof draft>) => d.change({ selectedMedia: [] }),
    (d: ReturnType<typeof draft>) => d.change({ selectedMedia: [...d.get().selectedMedia, asset("other")] }),
    (d: ReturnType<typeof draft>) => d.change({ postKind: "text" }),
  ];
  for (const mutate of mutations) {
    const d = draft(); const commit = captureBrowserMediaCommit(d.get); mutate(d);
    assert.equal(commit([asset("late")]), false); assert.equal(d.get().selectedMedia.some(a => a.id === "late"), false);
  }
  const d = draft(); let active = true; const commit = captureBrowserMediaCommit(d.get, () => active);
  active = false; assert.equal(commit([asset("unmounted")]), false);
});
