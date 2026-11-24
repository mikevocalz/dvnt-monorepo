import assert from "node:assert/strict";
import { test } from "node:test";
import { cropExportMimeType, inspectCropExport, replaceCroppedMedia } from "./crop-export.ts";
import { publishMediaFile } from "./live-photo-original.ts";

const still = { id: "still", type: "image" as const, kind: "image", uri: "file:///original" };
const gif = { id: "gif", type: "image" as const, kind: "gif", uri: "file:///gif" };
const video = { id: "video", type: "video" as const, kind: "video", uri: "file:///video" };
const live = { id: "live", type: "image" as const, kind: "livePhoto", uri: "file:///live", pairedVideoUri: "file:///motion" };

test("crop completion replaces only by current attachment ID without shifting other indices", () => {
  const edited = { ...still, uri: "file:///new" };
  const latest = [video, still, live, gif];
  assert.deepEqual(replaceCroppedMedia(latest, [edited]), [video, edited, live, gif]);
  assert.equal(replaceCroppedMedia(latest, [edited])[2], live);
  assert.deepEqual(replaceCroppedMedia([gif, video], [edited]), [gif, video]);
});

test("only an explicit still export reaches upload unchanged with the requested MIME", async () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    const mime = cropExportMimeType(format);
    const draft = { ...still, uri: "file:///edited", mimeType: "image/heic", editedUri: "file:///edited", editorOpened: true, cropExportMimeType: mime };
    const upload = publishMediaFile(draft);
    assert.equal(upload.uri, "file:///edited");
    assert.deepEqual(await inspectCropExport(upload, 1024, async (uri) => {
      assert.equal(uri, "file:///edited");
      return 1024;
    }), { ok: true, mimeType: mime });
    assert.equal(publishMediaFile({ ...draft, editedUri: undefined }).cropExportMimeType, undefined);
  }
});

test("raw still, GIF, video and Live Photo never inherit the sanitizer exemption", async () => {
  const byteSize = async () => { throw new Error("not an edited still"); };
  for (const media of [still, { ...still, mimeType: "image/png" }, { ...gif, cropExportMimeType: "image/png" as const }, { ...video, cropExportMimeType: "image/png" as const }, { ...live, cropExportMimeType: "image/png" as const }]) {
    assert.equal(await inspectCropExport(media, 1024, byteSize), null);
  }
  const uploaded = publishMediaFile({ ...live, originalUri: live.uri, editorOpened: true, editedUri: "file:///wrong", cropExportMimeType: "image/png" });
  assert.equal(uploaded.uri, live.uri);
  assert.equal(uploaded.pairedVideoUri, live.pairedVideoUri);
  assert.equal(uploaded.cropExportMimeType, undefined);
});

test("oversized or unreadable edited bytes report an actionable failure, not a destructive re-encode", async () => {
  const edited = { ...still, cropExportMimeType: "image/webp" as const };
  const cap = 10 * 1024 * 1024;
  const oversized = await inspectCropExport(edited, cap, async () => cap + 1);
  assert.match(oversized?.ok === false ? oversized.error : "", /10 MB upload limit.*smaller Max Edge/);
  const unreadable = await inspectCropExport(edited, cap, async () => { throw new Error("missing"); });
  assert.match(unreadable?.ok === false ? unreadable.error : "", /could not be read/);
});
