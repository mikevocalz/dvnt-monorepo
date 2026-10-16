import test from "node:test";
import assert from "node:assert/strict";
import { controlsLayout } from "./controls-layout.ts";

test("native dock fits narrow phones and landscape safe areas with usable targets", () => {
  for (const [width, left, right] of [[320, 0, 0], [360, 0, 0], [375, 0, 0], [390, 0, 0], [667, 44, 44], [844, 59, 59], [768, 0, 0], [1024, 0, 0]]) {
    for (const count of [4, 5]) {
      const dock = controlsLayout(width, left, right, count);
      assert.ok(dock.size >= 44);
      const occupied = left + right + dock.sidePadding * 2 + dock.glassPadding * 2 + 2 + dock.size * count + dock.gap * (count - 1);
      assert.ok(occupied <= width, `${count} controls overflow ${width}pt: ${occupied}`);
    }
  }
});
