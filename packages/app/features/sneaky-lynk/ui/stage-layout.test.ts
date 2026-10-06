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

// ── Host stage: 1 vs 2 hosts at phone, tablet and desktop widths ──────────
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HOST_STAGE_MAX_WIDTH, HOST_TILE_GAP, hostStageLayout } from "./stage-layout.ts";

const WIDTHS = [
  { name: "phone", w: 390 - 24, h: 844, platform: "native" as const },
  { name: "tablet portrait", w: 1024 - 24, h: 1366, platform: "native" as const },
  { name: "tablet landscape", w: 1366 - 24, h: 1024, platform: "native" as const },
  { name: "desktop web", w: 1440 - 48, h: 900, platform: "web" as const },
  { name: "phone web", w: 390 - 32, h: 844, platform: "web" as const },
];

test("one host fills the stage; two split it with the same stage box", () => {
  for (const s of WIDTHS) {
    const maxH = Math.round(s.h * 0.44);
    const one = hostStageLayout(1, s.w, maxH, s.platform);
    const two = hostStageLayout(2, s.w, maxH, s.platform);
    assert.deepEqual(one.stage, two.stage, `${s.name}: stage must not jump between 1 and 2 hosts`);
    assert.deepEqual(one.tiles, [one.stage], s.name);
    assert.equal(two.tiles.length, 2, s.name);
    const used = two.tiles[0].width + two.tiles[1].width + two.gap;
    assert.ok(used <= two.stage.width, `${s.name}: the pair overflows (${used} > ${two.stage.width})`);
    assert.ok(two.stage.width - used <= 1, `${s.name}: the pair leaves a gap`);
    assert.equal(two.gap, HOST_TILE_GAP);
    // Halves keep the hero's height and stay between 3:4 and 16:9.
    for (const t of two.tiles) {
      assert.equal(t.height, two.stage.height, s.name);
      assert.ok(ratio(t) >= 0.75 && ratio(t) <= HERO_ASPECT, `${s.name}: tile aspect ${ratio(t)}`);
    }
    assert.ok(one.stage.width <= s.w, `${s.name}: wider than the screen`);
  }
});

test("web and tablets cap the stage at max-w-3xl; phones stay full width", () => {
  const maxH = 10_000; // height never binds here, so only the width cap shows
  // heroBox rounds through the 16:9 height, so full width is within 1pt.
  assert.ok(366 - hostStageLayout(1, 366, maxH, "native").stage.width <= 1);
  assert.ok(358 - hostStageLayout(1, 358, maxH, "web").stage.width <= 1);
  assert.equal(hostStageLayout(1, 1000, maxH, "native").stage.width, HOST_STAGE_MAX_WIDTH);
  assert.equal(hostStageLayout(2, 1342, maxH, "native").stage.width, HOST_STAGE_MAX_WIDTH);
  assert.equal(hostStageLayout(1, 1392, maxH, "web").stage.width, HOST_STAGE_MAX_WIDTH);
  assert.equal(hostStageLayout(2, 1392, maxH, "web").tiles[0].width, (HOST_STAGE_MAX_WIDTH - HOST_TILE_GAP) / 2);
});

test("a host leaving collapses two tiles back to one; nobody hosting draws none", () => {
  assert.equal(hostStageLayout(2, 366, 400, "native").tiles.length, 2);
  assert.equal(hostStageLayout(1, 366, 400, "native").tiles.length, 1);
  assert.equal(hostStageLayout(0, 366, 400, "native").tiles.length, 0);
  assert.equal(hostStageLayout(3, 366, 400, "native").tiles.length, 2, "the top holds two hosts at most");
});

test("the stage cap is the app's max-w-3xl content column", () => {
  const sheet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "lib", "ui", "sheet-metrics.ts"), "utf8");
  const m = sheet.match(/MAX_SHEET_WIDTH = (\d+);/);
  assert.ok(m, "MAX_SHEET_WIDTH moved");
  assert.equal(Number(m[1]), HOST_STAGE_MAX_WIDTH);
});
