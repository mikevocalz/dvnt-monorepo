import test from "node:test";
import assert from "node:assert/strict";
import {
  clampGroupCallPage,
  findSpeakingPage,
  getGroupCallLayout,
  getGroupCallPage,
  getGroupCallTileSize,
  MAX_TILE_ASPECT,
  moveGroupCallPage,
  orderGroupCallTiles,
} from "./group-call-layout.ts";

test("uses product page sizes at phone, tablet, and desktop viewports", () => {
  assert.deepEqual(getGroupCallLayout(390, 844), { columns: 2, rows: 3, pageSize: 6 });
  assert.deepEqual(getGroupCallLayout(844, 390), { columns: 4, rows: 2, pageSize: 8 });
  assert.deepEqual(getGroupCallLayout(820, 1180), { columns: 3, rows: 3, pageSize: 9 });
  assert.deepEqual(getGroupCallLayout(1440, 900), { columns: 4, rows: 3, pageSize: 12 });
});

test("slices twelve unified tiles without mounting an off-page tile", () => {
  const tiles = Array.from({ length: 12 }, (_, index) => ({ id: String(index) }));
  const first = getGroupCallPage(tiles, 0, 6);
  const second = getGroupCallPage(tiles, 1, 6);
  assert.deepEqual(first.visibleTiles.map((tile) => tile.id), ["0", "1", "2", "3", "4", "5"]);
  assert.deepEqual(second.visibleTiles.map((tile) => tile.id), ["6", "7", "8", "9", "10", "11"]);
  assert.equal(second.pageCount, 2);
});

test("clamps the current page after people leave", () => {
  assert.equal(clampGroupCallPage(1, 5, 6), 0);
  assert.equal(clampGroupCallPage(3, 12, 6), 1);
  assert.equal(clampGroupCallPage(2, 0, 6), 0);
});

test("next and previous navigation stop at page boundaries", () => {
  assert.equal(moveGroupCallPage(0, -1, 2), 0);
  assert.equal(moveGroupCallPage(0, 1, 2), 1);
  assert.equal(moveGroupCallPage(1, 1, 2), 1);
  assert.equal(moveGroupCallPage(1, -1, 2), 0);
});

test("local tile inclusion stays stable while remotes change", () => {
  const local = { id: "local", isLocal: true };
  const remotes = [{ id: "a", isLocal: false }, { id: "b", isLocal: false }];
  assert.deepEqual(orderGroupCallTiles(local, remotes).map((tile) => tile.id), ["local", "a", "b"]);
  assert.deepEqual(orderGroupCallTiles(local, remotes.slice(1)).map((tile) => tile.id), ["local", "b"]);
});

test("no tile is flatter than 16:9, and tall cells are left alone", () => {
  // Landscape phone: 4 columns across 369pt with 88pt of usable height gives
  // an 86x40 cell, flatter than 2:1. Width gives way, height is kept.
  const flat = getGroupCallTileSize(369, 88, { columns: 4, rows: 2 }, 8);
  assert.equal(Math.round(flat.height), 40);
  assert.equal(Math.round(flat.width), 71);
  assert.ok(
    flat.width / flat.height <= MAX_TILE_ASPECT + 1e-9,
    `tile is ${(flat.width / flat.height).toFixed(2)}:1, flatter than 16:9`,
  );
  assert.ok(flat.width < 86, "a flat cell must give width back, not keep it");

  // Portrait phone: a 179x166 cell is squarer than 16:9, so it is used as is.
  const tall = getGroupCallTileSize(366, 513, { columns: 2, rows: 3 }, 8);
  assert.equal(Math.round(tall.width), 179);
  assert.equal(Math.round(tall.height), 166);

  // Desktop 4x3 is also within the clamp and must not be narrowed.
  const desktop = getGroupCallTileSize(1380, 700, { columns: 4, rows: 3 }, 8);
  assert.equal(Math.round(desktop.width), 339);
  assert.equal(Math.round(desktop.height), 228);
});

test("reports a speaker stranded on another page, and stays quiet otherwise", () => {
  const ids = Array.from({ length: 12 }, (_, index) => `p${index}`);
  assert.equal(findSpeakingPage(ids, ["p7"], 6, 0), 1);
  assert.equal(findSpeakingPage(ids, ["p2"], 6, 0), null, "same page needs no banner");
  assert.equal(findSpeakingPage(ids, [], 6, 0), null);
  assert.equal(findSpeakingPage(ids, ["p0"], 6, 1), 0, "pointing backwards works too");
  // First speaker wins when several pages are live.
  assert.equal(findSpeakingPage(ids, ["p11", "p6"], 6, 0), 1);
});

test("mixed local and remote literals infer a single tile type", () => {
  // Regression: an unconstrained generic pinned isLocal to the literal `false`
  // from the remote array, so the local tile's `true` stopped compiling.
  const ordered = orderGroupCallTiles(
    { id: "local", isLocal: true },
    [{ id: "a", isLocal: false }],
  );
  assert.deepEqual(ordered.map((tile) => tile.isLocal), [true, false]);
});
