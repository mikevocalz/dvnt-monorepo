import test from "node:test";
import assert from "node:assert/strict";
import { commentGifFromItem, isCommentGif } from "./gif-attachment.ts";
import type { KlipyItem } from "../stickers/api/klipy";

const format = (url = "https://static.klipy.com/wave.webp") => ({
  url,
  width: 320,
  height: 240,
});
const item: KlipyItem = {
  id: "wave",
  title: "Wave",
  created: 0,
  url: "",
  media_formats: {
    webp: format("https://static.klipy.com/hd.webp"),
    tinywebp: format(),
    nanowebp: format("https://static1.klipy.com/preview.webp"),
  },
};
test("small animated asset and smallest preview preserve provider metadata", () => {
  const gif = commentGifFromItem(item, "klipy")!;
  assert.equal(gif.url, item.media_formats.tinywebp!.url);
  assert.equal(gif.previewUrl, item.media_formats.nanowebp!.url);
  assert.equal(gif.provider, "klipy");
  assert.equal(gif.width, 320);
});
test("fallback is genuinely Noto, not mislabeled Klipy", () => {
  const noto = {
    ...item,
    media_formats: {
      gif: format(
        "https://fonts.gstatic.com/s/e/notoemoji/latest/1f389/512.gif",
      ),
    },
  };
  assert.equal(commentGifFromItem(noto, "fallback")!.provider, "noto");
  assert.equal(commentGifFromItem(noto, "klipy"), null);
});
test("unsafe provider URLs never reach a browser image request", () => {
  const valid = commentGifFromItem(item, "klipy")!;
  for (const url of [
    "http://static.klipy.com/a.gif",
    "https://static.klipy.com.evil.test/a.gif",
    "https://evil.test/a.gif",
    "https://user@static.klipy.com/a.gif",
    "https://static.klipy.com:8443/a.gif",
    "https://static.klipy.com/a.svg",
    "data:image/gif;base64,AA",
    "https://static.klipy.com/a.gif#x",
  ])
    assert.equal(isCommentGif({ ...valid, url }), false, url);
  assert.equal(
    isCommentGif({ ...valid, previewUrl: "https://evil.test/a.gif" }),
    false,
  );
});
test("malformed dimensions and oversized metadata cannot be selected", () => {
  const valid = commentGifFromItem(item, "klipy")!;
  for (const width of [0, -1, 1.5, 4097, NaN, Infinity])
    assert.equal(isCommentGif({ ...valid, width }), false);
  assert.equal(isCommentGif({ ...valid, id: "x".repeat(129) }), false);
  assert.equal(isCommentGif({ ...valid, title: "x".repeat(201) }), false);
  assert.equal(commentGifFromItem({ ...item, media_formats: {} }), null);
});

test("all three documented Klipy CDN hosts work, unrelated numbered hosts do not", () => {
  const valid = commentGifFromItem(item, "klipy")!;
  for (const host of ["static.klipy.com", "static1.klipy.com", "static2.klipy.com"]) {
    assert.equal(isCommentGif({ ...valid, url: `https://${host}/a.gif`, previewUrl: `https://${host}/p.webp` }), true);
  }
  for (const host of ["static3.klipy.com", "static12.klipy.com", "static2.klipy.com.evil.test"]) {
    assert.equal(isCommentGif({ ...valid, url: `https://${host}/a.gif` }), false);
  }
});
