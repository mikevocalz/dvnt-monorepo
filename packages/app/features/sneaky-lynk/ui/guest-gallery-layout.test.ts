import { test } from "node:test";
import assert from "node:assert/strict";
import { clampGalleryPage, guestGalleryPosition, roomGalleryLayout } from "./guest-gallery-layout.ts";

test("two people stack with equal-height videos on phones, tablets, and desktop", () => {
  for (const [width, height] of [[296, 320], [366, 540], [740, 650], [1024, 420], [1400, 620], [700, 150]]) {
    const layout = roomGalleryLayout(width, height, 1);
    assert.ok(layout.guestTop >= layout.host.height + layout.gap);
    assert.ok(Math.abs(layout.host.height - layout.tileHeight) <= 1);
    assert.equal(layout.columns, 1);
    assert.equal(layout.rows, 1);
    assert.equal(layout.pageCount, 1);
    assert.ok(layout.guestTop + layout.guestHeight <= height);
    assert.ok(layout.host.width <= width);
    assert.ok(layout.tileWidth <= width);
  }
});

test("additional guests form horizontal pages of rows, not a vertical feed or single strip", () => {
  const layout = roomGalleryLayout(390, 650, 9);
  assert.equal(layout.columns, 2);
  assert.equal(layout.rows, 2);
  assert.equal(layout.pageSize, 4);
  assert.equal(layout.pageCount, 3);
  assert.deepEqual(guestGalleryPosition(0, layout), { page: 0, left: 0, top: 0 });
  assert.equal(guestGalleryPosition(2, layout).top, layout.tileHeight + layout.gap);
  assert.equal(guestGalleryPosition(4, layout).left, layout.width);
  assert.equal(guestGalleryPosition(8, layout).left, layout.width * 2);
});

test("short landscape rooms keep the host above a one-row guest page", () => {
  const layout = roomGalleryLayout(700, 180, 9);
  assert.equal(layout.columns, 2);
  assert.equal(layout.rows, 1);
  assert.equal(layout.pageCount, 5);
  assert.ok(layout.guestTop > 0);
  assert.ok(layout.contentHeight + layout.footerHeight <= 180);
});

test("join and leave transitions preserve the host region and clamp departed pages", () => {
  const duo = roomGalleryLayout(390, 650, 1);
  const joined = roomGalleryLayout(390, 650, 5);
  const left = roomGalleryLayout(390, 650, 2);
  assert.equal(duo.pageCount, 1);
  assert.equal(joined.pageCount, 2);
  assert.equal(left.pageCount, 1);
  assert.equal(clampGalleryPage(1, left.pageCount), 0);
  assert.equal(clampGalleryPage(0, joined.pageCount), 0);
  assert.deepEqual(joined.host, left.host, "guest changes do not resize the group host");
});

test("all pages fit within measured usable space, including narrow and tiny layouts", () => {
  for (const width of [0, 120, 260, 320, 768, 1440]) {
    for (const height of [0, 30, 180, 400, 900]) {
      for (const count of [0, 1, 2, 5, 20]) {
        const layout = roomGalleryLayout(width, height, count);
        assert.ok(layout.width <= width);
        assert.ok(layout.host.height + layout.gap + layout.guestHeight <= height);
        assert.ok(layout.contentHeight + layout.footerHeight <= height);
        assert.ok(layout.tileHeight >= 0 && layout.tileWidth >= 0);
        for (let i = 0; i < count; i++) {
          const box = guestGalleryPosition(i, layout);
          assert.ok(box.left >= box.page * layout.width);
          assert.ok(box.left + layout.tileWidth <= (box.page + 1) * layout.width);
          assert.ok(box.top + layout.tileHeight <= layout.guestHeight);
        }
      }
    }
  }
});

test("missing or invalid measurements never produce invalid CSS dimensions", () => {
  for (const value of [NaN, Infinity, -Infinity, -1]) {
    const layout = roomGalleryLayout(value, value, value);
    assert.equal(layout.width, 0);
    assert.equal(layout.contentHeight, 0);
    assert.equal(layout.pageCount, 1);
    assert.ok(Object.values(layout.host).every(Number.isFinite));
    assert.equal(clampGalleryPage(-1, 1), 0);
  }
});
