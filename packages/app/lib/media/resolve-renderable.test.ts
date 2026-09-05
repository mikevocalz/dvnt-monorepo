/**
 * Render-side media resolver tests. Run:
 *   node --import tsx --test packages/app/lib/media/resolve-renderable.test.ts
 *
 * Cases are taken from the actual shapes in the production `media` table
 * (1350 rows, surveyed 2026-08-05), not invented: the 16 rows typed `image`
 * with a video MIME, the 42 QuickTime videos and 39 HEIC images that iPhone
 * Live Photos produce, the 162 rows with a NULL mime_type, and the fact that
 * every thumbnail column is currently NULL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  needsPlaceholder,
  resolvePosterUrl,
  resolveRenderableMedia,
} from "./resolve-renderable";

const CDN = "https://dvnt.b-cdn.net";

test("plain image resolves to itself", () => {
  const r = resolveRenderableMedia({
    url: `${CDN}/post-image/u/2026/07/a.jpg`,
    type: "image",
    mimeType: "image/jpeg",
  });
  assert.equal(r.kind, "image");
  assert.equal(r.posterUrl, `${CDN}/post-image/u/2026/07/a.jpg`);
  assert.equal(r.videoUrl, null);
  assert.equal(r.browserUnsupported, false);
  assert.equal(r.reason, "ok");
});

// THE regression this module exists to prevent.
test("a video NEVER yields a poster URL that is the video itself", () => {
  const r = resolveRenderableMedia({
    url: `${CDN}/post-video/u/2026/07/clip.mp4`,
    type: "video",
    mimeType: "video/mp4",
  });
  assert.equal(r.kind, "video");
  assert.equal(r.posterUrl, null, "poster must not be the mp4");
  assert.equal(r.videoUrl, `${CDN}/post-video/u/2026/07/clip.mp4`);
  assert.equal(r.reason, "video_without_poster");
  assert.equal(resolvePosterUrl(r as never), null);
});

// The 16 production rows typed `image` that carry a video MIME.
test("a row mistyped as image but with a video MIME is treated as video", () => {
  const r = resolveRenderableMedia({
    url: `${CDN}/post-image/u/2026/07/mislabeled.mp4`,
    type: "image", // wrong in the DB
    mimeType: "video/mp4",
  });
  assert.equal(r.kind, "video");
  assert.equal(r.posterUrl, null);
  assert.equal(r.videoUrl, `${CDN}/post-image/u/2026/07/mislabeled.mp4`);
});

test("extension rescues a row with a NULL mime_type", () => {
  const r = resolveRenderableMedia({
    url: `${CDN}/post-image/u/2026/07/clip.mov`,
    type: "image",
    mimeType: null,
  });
  assert.equal(r.kind, "video");
  assert.equal(r.posterUrl, null);
  assert.equal(r.browserUnsupported, true);
  assert.equal(r.reason, "quicktime_video");
});

// iPhone Live Photo pair — the "live photos are gone" report.
test("HEIC images are flagged unsupported rather than rendered blank", () => {
  const r = resolveRenderableMedia({
    url: `${CDN}/post-image/u/2026/07/live.heic`,
    type: "image",
    mimeType: "image/heic",
  });
  assert.equal(r.kind, "image");
  assert.equal(r.browserUnsupported, true);
  assert.equal(r.reason, "heic_image");
  assert.equal(resolvePosterUrl(r as never), null, "caller must show a placeholder");
  assert.equal(needsPlaceholder({ url: r.posterUrl, mimeType: "image/heic" }), true);
});

test("QuickTime video is flagged unsupported but still exposes videoUrl", () => {
  const r = resolveRenderableMedia({
    url: `${CDN}/post-video/u/2026/07/live.mov`,
    type: "video",
    mimeType: "video/quicktime",
  });
  assert.equal(r.browserUnsupported, true);
  assert.equal(r.reason, "quicktime_video");
  // Safari and native CAN play it, so the URL is still handed over.
  assert.equal(r.videoUrl, `${CDN}/post-video/u/2026/07/live.mov`);
  assert.equal(r.posterUrl, null);
});

test("a real stored poster is used for a video", () => {
  const r = resolveRenderableMedia({
    url: `${CDN}/post-video/u/2026/07/clip.mp4`,
    type: "video",
    mimeType: "video/mp4",
    thumbnailUrl: `${CDN}/post-video/u/2026/07/clip-poster.jpg`,
  });
  assert.equal(r.posterUrl, `${CDN}/post-video/u/2026/07/clip-poster.jpg`);
  assert.equal(r.reason, "ok");
});

// Defends against the legacy `?thumb=true` backfill, which stored the video
// URL in the thumbnail slot.
test("a poisoned thumbnail that is really a video is rejected", () => {
  const r = resolveRenderableMedia({
    url: `${CDN}/post-video/u/2026/07/clip.mp4`,
    type: "video",
    mimeType: "video/mp4",
    thumbnailUrl: `${CDN}/post-video/u/2026/07/clip.mp4?thumb=true`,
  });
  assert.equal(r.posterUrl, null, "must not trust a video URL as a poster");
  assert.equal(r.reason, "video_without_poster");
});

test("query strings do not confuse extension detection", () => {
  const r = resolveRenderableMedia({
    url: `${CDN}/post-video/u/2026/07/clip.mp4?width=400&v=2`,
    mimeType: null,
  });
  assert.equal(r.kind, "video");
});

test("a filename extension beats a missing MIME and a missing url extension", () => {
  const r = resolveRenderableMedia({
    url: `${CDN}/post-image/u/2026/07/abcdef0123`,
    filename: "IMG_4821.HEIC",
    mimeType: null,
    type: "image",
  });
  assert.equal(r.browserUnsupported, true);
  assert.equal(r.reason, "heic_image");
});

test("missing source is reported, not guessed", () => {
  const r = resolveRenderableMedia({ url: null, mimeType: null, type: "image" });
  assert.equal(r.reason, "no_source");
  assert.equal(r.posterUrl, null);
  assert.equal(r.videoUrl, null);
  assert.equal(needsPlaceholder({ url: null }), true);
});

test("empty-string url is treated as missing", () => {
  const r = resolveRenderableMedia({ url: "   ", type: "image" });
  assert.equal(r.reason, "no_source");
});

test("gif and webp stay ordinary images", () => {
  for (const [url, mime] of [
    [`${CDN}/a.gif`, "image/gif"],
    [`${CDN}/a.webp`, "image/webp"],
    [`${CDN}/a.png`, "image/png"],
  ] as const) {
    const r = resolveRenderableMedia({ url, mimeType: mime, type: "image" });
    assert.equal(r.kind, "image", url);
    assert.equal(r.posterUrl, url);
    assert.equal(r.browserUnsupported, false, url);
  }
});
