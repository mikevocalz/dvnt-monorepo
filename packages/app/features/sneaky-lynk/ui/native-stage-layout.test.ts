import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { nativeRoomStageLayout } from "./native-stage-layout.ts";

// Dimensions are the remaining stage rectangle, not the whole screen.
const stages = [
  { name: "small phone", width: 320, height: 290 },
  { name: "phone portrait", width: 390, height: 490 },
  { name: "short landscape", width: 667, height: 140 },
  { name: "notched landscape", width: 756, height: 170 },
  { name: "tablet portrait", width: 768, height: 740 },
  { name: "tablet landscape", width: 1024, height: 480 },
];
for (const stage of stages) {
  for (const count of [1, 2, 12, 20]) {
    for (const hostCount of [1, 2].filter((n) => n <= count)) {
      test(`${stage.name}: ${count} participants, ${hostCount} hosts fit measured stage`, () => {
        const result = nativeRoomStageLayout(stage.width, stage.height, hostCount, count - hostCount);
        assert.ok(result.host.stage.height <= result.hostRegionHeight);
        assert.ok(result.host.stage.width <= result.hostRegionWidth);
        if (result.sideBySide) {
          assert.ok(result.hostRegionWidth + result.gap + result.crowdRegionWidth <= stage.width);
          assert.ok(result.crowdRegionHeight <= stage.height);
        } else {
          assert.ok(result.hostRegionHeight + result.gap + result.crowdRegionHeight <= stage.height);
        }
        assert.ok(result.tileWidth * result.crowdColumns + result.gap * (result.crowdColumns - 1) <= result.crowdRegionWidth - 24);
        if (count > hostCount) {
          assert.ok(result.tileWidth >= 96, "faces keep usable width");
          assert.ok(result.tileHeight >= (result.duo ? 64 : 96), "faces keep usable height");
          assert.ok(result.tileHeight <= result.crowdViewportHeight, "one complete row is visible");
          // A normal vertical scroll extent reaches the last tile's entire row.
          const rows = Math.ceil((count - hostCount) / result.crowdColumns);
          const contentHeight = rows * result.tileHeight + (rows - 1) * result.gap + (result.duo ? 0 : 8);
          const maxScroll = Math.max(0, contentHeight - result.crowdViewportHeight);
          const lastBottom = contentHeight - (result.duo ? 0 : 8) - maxScroll;
          assert.ok(lastBottom <= result.crowdViewportHeight);
          assert.ok(lastBottom - result.tileHeight >= 0, "last participant is fully reachable");
        }
      });
    }
  }
}

test("short landscape places focus beside the crowd", () => {
  assert.equal(nativeRoomStageLayout(667, 140, 1, 19).sideBySide, true);
  assert.equal(nativeRoomStageLayout(390, 490, 1, 19).sideBySide, false);
});

test("zero or invalid measurements never create negative or nonfinite boxes", () => {
  for (const [width, height] of [[0, 0], [4, 1], [-20, -30], [NaN, Infinity]]) {
    const result = nativeRoomStageLayout(width, height, 1, 19);
    for (const value of Object.values(result)) {
      if (typeof value === "number") assert.ok(Number.isFinite(value) && value >= 0);
    }
  }
});

test("crowd uses a stable unvirtualized tile list so scrolling never disconnects media", () => {
  const source = readFileSync(new URL("./RoomStage.tsx", import.meta.url), "utf8");
  assert.match(source, /removeClippedSubviews=\{false\}/);
  assert.match(source, /attendees\.map\(\(participant\) => \(/);
  assert.match(source, /key=\{participant\.id\}/);
  assert.doesNotMatch(source, /pages\.map|<VideoGrid|totalCount >= 2/);
});


test("duo equal regions never round beyond odd-sized containers", () => {
  for (const [width, height] of [[321, 291], [375, 489], [667, 141]]) {
    const result = nativeRoomStageLayout(width, height, 1, 1);
    assert.equal(result.host.stage.width, result.tileWidth);
    assert.equal(result.host.stage.height, result.tileHeight);
    if (result.sideBySide) {
      assert.ok(result.hostRegionWidth + result.gap + result.crowdRegionWidth <= width);
    } else {
      assert.ok(result.hostRegionHeight + result.gap + result.crowdRegionHeight <= height);
    }
  }
});
