import test from "node:test";
import assert from "node:assert/strict";
import type { MediaAsset } from "../../lib/hooks/use-media-picker";
import { readBrowserMediaFiles, type BrowserPairedMedia, associateBrowserMedia, separateBrowserMedia, mergeByAppleContentId, captureBrowserMediaReplacement, releaseUnselectedBrowserMedia } from "./browser-media-intake.ts";
import { sizeLimitForKind } from "../../lib/media/upload-policy.ts";

const image = (name = "IMG_1234.jpg", type = "image/jpeg") => new File([new Uint8Array([255, 216, 0, 1, 2, 3])], name, { type });
const video = (name = "IMG_1234.mov", type = "video/quicktime") => new File([new Uint8Array([0, 1, 2, 3, 4, 255])], name, { type });
const readDuration = async () => 3;
const readFiles = (files: File[]) => readBrowserMediaFiles(files, { readDuration });

test("one multi-file intake preserves originals and never pairs even unique matching filenames", async () => {
  const files = [image(), video()]; const result = await readFiles(files);
  assert.deepEqual(result.errors, []); assert.deepEqual(result.assets.map(item => item.kind), ["image", "video"]);
  assert.ok(result.assets.every(item => !item.pairedVideoUri));
  for (let i = 0; i < files.length; i++) assert.deepEqual(await (await fetch(result.assets[i].uri)).arrayBuffer(), await files[i].arrayBuffer());
  releaseUnselectedBrowserMedia(result.assets, []);
});

test("empty OS MIME uses approved extensions for format only; HEIF and corrupt/oversize motion fail", async () => {
  const result = await readFiles([image("photo.HEIC", ""), video("different.MOV", "")]);
  assert.deepEqual(result.assets.map(item => item.mimeType), ["image/heic", "video/quicktime"]);
  releaseUnselectedBrowserMedia(result.assets, []);
  const bad = await readFiles([image("photo.heif", "image/heif"), new File([new Uint8Array(sizeLimitForKind("post-video") + 1)], "large.mp4", { type: "video/mp4" })]);
  assert.equal(bad.assets.length, 0); assert.equal(bad.errors.length, 2);
  for (const duration of [null, 0, NaN, Infinity, 61]) {
    const invalid = await readBrowserMediaFiles([video()], { readDuration: async () => duration });
    assert.equal(invalid.assets.length, 0); assert.equal(invalid.errors.length, 1);
  }
});

test("a generic octet-stream MIME falls back to the extension and the upload blob carries the real type", async () => {
  const result = await readFiles([image("IMG_0001.HEIC", "application/octet-stream"), video("IMG_0001.MOV", "application/octet-stream")]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.assets.map(item => item.mimeType), ["image/heic", "video/quicktime"]);
  assert.deepEqual(await Promise.all(result.assets.map(async item => (await (await fetch(item.uri)).blob()).type)), ["image/heic", "video/quicktime"]);
  releaseUnselectedBrowserMedia(result.assets, []);
  const unknown = await readFiles([image("notes.txt", "application/octet-stream")]);
  assert.equal(unknown.assets.length, 0); assert.equal(unknown.errors.length, 1);
});

const withIds = (ids: Record<string, string>) => ({ readDuration, readContentId: async (file: Blob) => ids[(file as File).name] ?? null });
const names = (media: readonly MediaAsset[]) => media.map(item => `${item.fileName}:${item.kind}`);

test("matching Apple content identifiers pair automatically; missing or ambiguous ones stay separate", async () => {
  const ids = { "a.HEIC": "ID-A", "a.MOV": "ID-A", "b.HEIC": "ID-B", "c.HEIC": "ID-C", "c2.HEIC": "ID-C", "c.MOV": "ID-C" };
  const files = [image("a.HEIC", "image/heic"), video("a.MOV"), image("b.HEIC", "image/heic"), video("x.MOV"), image("c.HEIC", "image/heic"), image("c2.HEIC", "image/heic"), video("c.MOV")];
  const { assets } = await readBrowserMediaFiles(files, withIds(ids));
  const { media, removed } = mergeByAppleContentId([], assets);
  assert.deepEqual(names(media), ["a.HEIC:livePhoto", "b.HEIC:image", "x.MOV:video", "c.HEIC:image", "c2.HEIC:image", "c.MOV:video"]);
  assert.equal(media[0].pairedVideoUri, assets[1].uri); assert.deepEqual(removed, []);
  releaseUnselectedBrowserMedia(assets, []);
});

test("an exported pair replaces the lone sidebar still; a held Live Photo is not duplicated; a split stays split", async () => {
  const ids = { "sidebar.jpg": "ID-A", "a.HEIC": "ID-A", "a.MOV": "ID-A" };
  const first = mergeByAppleContentId([], (await readBrowserMediaFiles([image("sidebar.jpg")], withIds(ids))).assets);
  const second = mergeByAppleContentId(first.media, (await readBrowserMediaFiles([image("a.HEIC", "image/heic"), video("a.MOV")], withIds(ids))).assets);
  assert.deepEqual(names(second.media), ["a.HEIC:livePhoto"]); assert.deepEqual(names(second.removed), ["sidebar.jpg:image"]);
  const again = mergeByAppleContentId(second.media, (await readBrowserMediaFiles([image("a.HEIC", "image/heic"), video("a.MOV")], withIds(ids))).assets);
  assert.deepEqual(names(again.media), ["a.HEIC:livePhoto"]);
  const split = separateBrowserMedia(second.media, second.media[0].id); assert.ok(split.ok); if (!split.ok) return;
  const later = mergeByAppleContentId(split.media, (await readBrowserMediaFiles([image("other.jpg")], withIds(ids))).assets);
  assert.deepEqual(names(later.media), ["a.HEIC:image", "a.MOV:video", "other.jpg:image"]);
});

test("the motion half can arrive after its still", async () => {
  const ids = { "a.HEIC": "ID-A", "a.MOV": "ID-A" };
  const first = mergeByAppleContentId([], (await readBrowserMediaFiles([image("a.HEIC", "image/heic")], withIds(ids))).assets);
  const second = mergeByAppleContentId(first.media, (await readBrowserMediaFiles([video("a.MOV")], withIds(ids))).assets);
  assert.deepEqual(names(second.media), ["a.HEIC:livePhoto"]); assert.deepEqual(second.removed, []);
});

test("explicit association preserves chosen identities and disassociation restores both without revocation", async () => {
  const { assets } = await readFiles([image(), image(), video()]);
  const pair = await associateBrowserMedia(assets, assets[1].id, assets[2].id, readDuration);
  assert.ok(pair.ok); if (!pair.ok) return;
  assert.equal(pair.media.length, 2); assert.equal(pair.media[0].kind, "image");
  assert.equal(pair.media[1].id, assets[1].id); assert.equal(pair.media[1].pairedVideoUri, assets[2].uri);
  assert.equal(pair.media[1].uri, assets[1].uri); assert.equal(pair.media[1].kind, "livePhoto");
  releaseUnselectedBrowserMedia(assets, pair.media);
  assert.equal((await fetch(assets[2].uri)).ok, true, "paired source URL still owned");
  const separated = separateBrowserMedia(pair.media, assets[1].id);
  assert.ok(separated.ok); if (!separated.ok) return;
  assert.deepEqual(separated.media, assets);
  releaseUnselectedBrowserMedia(pair.media, separated.media);
  assert.equal((await fetch(assets[2].uri)).ok, true, "split source URL still owned");
  releaseUnselectedBrowserMedia(separated.media, []);
  await assert.rejects(fetch(assets[2].uri));
});

test("ambiguous, wrong-kind and unplayable motion never invent a Live Photo", async () => {
  const { assets } = await readFiles([image(), image(), video()]);
  assert.equal((await associateBrowserMedia(assets, assets[0].id, assets[1].id, readDuration)).ok, false);
  assert.equal((await associateBrowserMedia(assets, assets[0].id, assets[2].id, async () => null)).ok, false);
  assert.deepEqual(assets.map(item => item.kind), ["image", "image", "video"]);
  releaseUnselectedBrowserMedia(assets, []);
});

test("twenty original files can become ten explicit pairs; separating cannot exceed ten published items", async () => {
  const files = Array.from({ length: 10 }, (_, i) => [image(`photo-${i}.jpg`), video(`clip-${i}.mov`)]).flat();
  const { assets } = await readFiles(files); let selected = assets;
  assert.equal(selected.length, 20);
  for (let i = 0; i < 10; i++) {
    const result = await associateBrowserMedia(selected, assets[i * 2].id, assets[i * 2 + 1].id, readDuration);
    assert.ok(result.ok); if (result.ok) selected = result.media;
  }
  assert.equal(selected.length, 10); assert.ok(selected.every(item => item.kind === "livePhoto"));
  assert.equal(separateBrowserMedia(selected, selected[0].id).ok, false);
  releaseUnselectedBrowserMedia([selected[0]], selected.slice(1));
  const split = separateBrowserMedia(selected.slice(1), selected[1].id);
  assert.ok(split.ok); if (split.ok) { assert.equal(split.media.length, 10); releaseUnselectedBrowserMedia(split.media, []); }
});

// A Pixel-layout Motion Photo: JPEG with XMP directory, MP4 appended at the end.
const motionPhoto = (name = "PXL_20240716_MP.jpg", stillPad = 0, videoPad = 0) => {
  const enc = (...parts: (string | number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap(p => typeof p === "string" ? [...p].map(c => c.charCodeAt(0)) : [...p]));
  const u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const box = (type: string, body: Uint8Array) => enc(u32(8 + body.length), type, body);
  const mp4 = enc(box("ftyp", enc("isom", u32(0))), box("mdat", new Uint8Array(6 + videoPad)), box("moov", enc(u32(0))));
  const xmp = enc("http://ns.adobe.com/xap/1.0/\0", `<x:xmpmeta GCamera:MotionPhoto="1"><Container:Item Item:Semantic="Primary"/><Container:Item Item:Semantic="MotionPhoto" Item:Length="${mp4.length}"/></x:xmpmeta>`);
  const head = enc([0xff, 0xd8, 0xff, 0xe1, (xmp.length + 2) >> 8, (xmp.length + 2) & 255], xmp), eoi = Uint8Array.of(0xff, 0xd9);
  return { file: new File([head, new Uint8Array(stillPad), eoi, mp4], name, { type: "image/jpeg" }), still: enc(head, eoi), mp4 };
};

test("an Android Motion Photo becomes one separable Live Photo pair that owns both blob URLs", async () => {
  const { file, still, mp4 } = motionPhoto();
  const read: string[] = [];
  const { assets, errors } = await readBrowserMediaFiles([file], { readDuration: async f => { read.push(`${f.name}:${f.type}`); return 2.5; } });
  assert.deepEqual(errors, []); assert.deepEqual(read, ["PXL_20240716_MP.mp4:video/mp4"]);
  const [pair] = assets as BrowserPairedMedia[];
  assert.equal(assets.length, 1); assert.equal(pair.kind, "livePhoto"); assert.equal(pair.type, "image"); assert.equal(pair.duration, 2.5);
  assert.equal(pair.fileSize, still.length); assert.equal(pair.pairedVideoUri, pair.browserPair?.motion.uri);
  const stillBlob = await (await fetch(pair.uri)).blob(), motionBlob = await (await fetch(pair.pairedVideoUri!)).blob();
  assert.equal(stillBlob.type, "image/jpeg"); assert.deepEqual(new Uint8Array(await stillBlob.arrayBuffer()), still);
  assert.equal(motionBlob.type, "video/mp4"); assert.deepEqual(new Uint8Array(await motionBlob.arrayBuffer()), mp4);
  const split = separateBrowserMedia(assets, pair.id); assert.ok(split.ok); if (!split.ok) return;
  assert.deepEqual(names(split.media), ["PXL_20240716_MP.jpg:image", "PXL_20240716_MP.mp4:video"]);
  releaseUnselectedBrowserMedia(assets, split.media);
  assert.equal((await fetch(pair.pairedVideoUri!)).ok, true, "split halves keep the URLs");
  releaseUnselectedBrowserMedia(split.media, []);
  await assert.rejects(fetch(pair.uri)); await assert.rejects(fetch(pair.pairedVideoUri!));
});

test("a Motion Photo whose motion cannot be used still posts as a plain photo; the still alone meets the photo limit", async () => {
  for (const duration of [null, 0, 61]) {
    const { file } = motionPhoto();
    const { assets, errors } = await readBrowserMediaFiles([file], { readDuration: async () => duration });
    assert.deepEqual(errors, []); assert.deepEqual(names(assets), ["PXL_20240716_MP.jpg:image"]);
    assert.equal(assets[0].fileSize, file.size, "fallback keeps every original byte");
    releaseUnselectedBrowserMedia(assets, []);
  }
  const big = motionPhoto("big.jpg", 9 * 1024 * 1024, 2 * 1024 * 1024).file;
  assert.ok(big.size > sizeLimitForKind("post-image"));
  const ok = await readFiles([big]); assert.deepEqual(ok.errors, []); assert.equal(ok.assets[0].kind, "livePhoto");
  releaseUnselectedBrowserMedia(ok.assets, []);
  const tooBigStill = motionPhoto("huge.jpg", 11 * 1024 * 1024).file;
  const refused = await readFiles([tooBigStill]); assert.equal(refused.assets.length, 0); assert.equal(refused.errors.length, 1);
});

test("only JPEG/HEIC are probed for motion; a failed second blob URL revokes the first", async () => {
  const { file } = motionPhoto();
  const png = new File([file], "renamed.png", { type: "image/png" });
  let probed = 0;
  const { assets } = await readBrowserMediaFiles([png], { readDuration: async () => { probed++; return 2; } });
  assert.equal(probed, 0); assert.deepEqual(names(assets), ["renamed.png:image"]);
  releaseUnselectedBrowserMedia(assets, []);
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL, created: string[] = [], revoked: string[] = [];
  URL.createObjectURL = (blob: Blob) => { if (blob.type === "video/mp4") throw new Error("quota"); const uri = create(blob); created.push(uri); return uri; };
  URL.revokeObjectURL = (uri: string) => { revoked.push(uri); revoke(uri); };
  try {
    await assert.rejects(readFiles([file]), /quota/);
  } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
  assert.equal(created.length, 1); assert.deepEqual(revoked, created);
});

test("review commits are atomic against draft changes, cancellation and >20 raw files", () => {
  const first: MediaAsset = { id: "first", uri: "blob:first", type: "image", kind: "image" };
  let state = { selectedMedia: [first], postKind: "media", textSlides: [{}], setSelectedMedia: (media: MediaAsset[]) => { state = { ...state, selectedMedia: media }; } };
  const commit = captureBrowserMediaReplacement(() => state);
  state = { ...state, textSlides: [{}] };
  assert.equal(commit([first]), false);
  assert.equal(captureBrowserMediaReplacement(() => state, () => false)([first]), false);
  assert.equal(captureBrowserMediaReplacement(() => state)(Array(21).fill(first)), false);
  assert.equal(captureBrowserMediaReplacement(() => state)(Array(20).fill(first)), true);
});
