/**
 * node --test packages/app/features/sneaky-lynk/ui/stage-layout.test.ts
 *
 * These import the real module. The file this replaces, grid-layout.test.ts,
 * kept its own local copy of the rule and asserted against that — so it went
 * on passing while the stage that users actually see drew a fixed 2 columns
 * at every width. A test that cannot fail when the code changes is not a test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HERO_ASPECT,
  MAX_TILE_ASPECT,
  crowdColumns,
  crowdTileBox,
  gridColumns,
  heroBox,
} from "./stage-layout.ts";

const PHONE = { w: 390, h: 844 };
const TABLET = { w: 1024, h: 1366 };
const TABLET_LANDSCAPE = { w: 1366, h: 1024 };
const GAP = 8;

const ratio = (b: { width: number; height: number }) => b.width / b.height;

test("a phone keeps two columns; a tablet earns more", () => {
  assert.equal(crowdColumns(PHONE.w), 2);
  assert.equal(crowdColumns(TABLET.w), 4);
  assert.equal(crowdColumns(TABLET_LANDSCAPE.w), 4);
  assert.equal(crowdColumns(768), 3, "a small tablet sits between the two");
});

test("the host hero holds 16:9 when the height cap binds", () => {
  // Landscape is where the old code broke: full-bleed width against a capped
  // height drew a 2.98:1 letterbox.
  const pageWidth = TABLET_LANDSCAPE.w - 24;
  const capped = heroBox(pageWidth, Math.round(TABLET_LANDSCAPE.h * 0.44));
  assert.ok(
    Math.abs(ratio(capped) - HERO_ASPECT) < 0.02,
    `hero came out ${ratio(capped).toFixed(2)}:1, expected 16:9`,
  );
  assert.ok(
    capped.width < pageWidth,
    "a capped hero must narrow, not stay full bleed",
  );
});

test("the hero fills the width when the cap does not bind", () => {
  const pageWidth = PHONE.w - 24;
  const box = heroBox(pageWidth, Math.round(PHONE.h * 0.44));
  assert.equal(box.width, pageWidth, "a phone hero is unchanged");
  assert.ok(Math.abs(ratio(box) - HERO_ASPECT) < 0.02);
});

test("crowd tiles never stretch past 16:9", () => {
  for (const screen of [PHONE, TABLET, TABLET_LANDSCAPE]) {
    const pageWidth = screen.w - 24;
    const cols = crowdColumns(screen.w);
    // A deliberately short crowd zone — the case that produced wide slabs.
    const tile = crowdTileBox(pageWidth, 340, cols, 2, GAP);
    assert.ok(
      ratio(tile) <= MAX_TILE_ASPECT + 0.01,
      `${screen.w}pt gave a ${ratio(tile).toFixed(2)}:1 tile`,
    );
  }
});

test("a tablet crowd tile is no longer a slab", () => {
  const pageWidth = TABLET.w - 24;
  const tilesAreaHeight = 482;
  // The old stage took the slot whole, with no aspect clamp — reproduced here
  // rather than called, because the clamp now lives inside crowdTileBox and
  // the bug is no longer reachable through it.
  const oldSlab = {
    width: Math.floor((pageWidth - GAP) / 2),
    height: Math.floor((tilesAreaHeight - GAP) / 2),
  };
  assert.ok(
    ratio(oldSlab) > 2,
    `the bug: two columns on a tablet gave ${ratio(oldSlab).toFixed(2)}:1`,
  );

  const now = crowdTileBox(
    pageWidth,
    tilesAreaHeight,
    crowdColumns(TABLET.w),
    2,
    GAP,
  );
  assert.ok(
    ratio(now) < ratio(oldSlab),
    "more columns must bring the tile back toward square",
  );
  assert.ok(ratio(now) < 1.3, `still wide at ${ratio(now).toFixed(2)}:1`);
});

test("a phone crowd tile is untouched — this was a tablet fix", () => {
  const pageWidth = PHONE.w - 24;
  const cols = crowdColumns(PHONE.w);
  const tile = crowdTileBox(pageWidth, 482, cols, 2, GAP);
  const slotWidth = Math.floor((pageWidth - GAP) / 2);
  assert.equal(cols, 2);
  assert.equal(tile.width, slotWidth, "no clamp should bind on a phone");
});

test("tiles stay legible at every width we ship", () => {
  for (const w of [320, 390, 700, 768, 1024, 1366]) {
    const pageWidth = w - 24;
    const cols = crowdColumns(w);
    const tile = crowdTileBox(pageWidth, 482, cols, 2, GAP);
    assert.ok(
      tile.width >= 110,
      `${w}pt gave a ${tile.width}pt tile across ${cols} columns`,
    );
  }
});

test("the flat grid keeps its rule: width fits, count wants", () => {
  assert.equal(gridColumns(2, PHONE.w), 1, "two stack on a phone");
  assert.equal(gridColumns(2, TABLET.w), 2, "two sit side by side on a tablet");
  for (const count of [4, 6, 9, 20]) {
    assert.ok(
      gridColumns(count, TABLET.w) > gridColumns(count, PHONE.w),
      `${count} participants should use more columns on a tablet`,
    );
  }
  // The phone numbers the previous test file pinned, kept verbatim.
  assert.equal(gridColumns(1, PHONE.w), 1);
  assert.equal(gridColumns(4, PHONE.w), 2);
  assert.equal(gridColumns(6, PHONE.w), 2);
});

test("degenerate inputs do not produce negative boxes", () => {
  assert.deepEqual(heroBox(0, 0), { width: 0, height: 0 });
  const tile = crowdTileBox(0, 0, 0, 0, GAP);
  assert.ok(tile.width >= 0 && tile.height >= 0);
});
