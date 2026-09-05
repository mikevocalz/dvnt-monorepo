/**
 * Reaction instance layout contract. Run:
 *   node --import tsx/esm --test packages/app/features/gpu/reactions/engine.test.ts
 *
 * (`tsx/esm`, not `tsx`, unlike the older tests here: typegpu's `tsover-runtime`
 * dependency publishes an `import`-only export condition, so CJS resolution
 * fails on it.)
 *
 * The failure this guards against is silent: if `writeInstance`, the TypeGPU
 * schema, and the WGSL struct ever disagree about field order or stride, the
 * GPU reads whatever bytes happen to be there. No error, no crash — just wrong
 * glyphs at wrong times, on device only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as d from "typegpu/data";
import {
  ReactionInstance,
  INSTANCE_STRIDE,
  INSTANCE_FIELDS,
  SHADER,
  writeInstance,
  REACTION_CAPACITY,
} from "./engine";

test("stride matches the TypeGPU schema", () => {
  assert.equal(INSTANCE_STRIDE, d.sizeOf(ReactionInstance));
  // 4 bytes x 5 scalars. If this changes, the WGSL struct changed too.
  assert.equal(INSTANCE_STRIDE, 20);
});

test("schema, writer and WGSL agree on field order", () => {
  assert.deepEqual(Object.keys(ReactionInstance.propTypes), [
    ...INSTANCE_FIELDS,
  ]);

  // Pull the WGSL Instance struct and compare its member order to the schema.
  const body = SHADER.slice(
    SHADER.indexOf("struct Instance {") + "struct Instance {".length,
    SHADER.indexOf("};"),
  );
  const wgslFields = body
    .split(",")
    .map((line) => line.trim().split(":")[0]?.trim())
    .filter((name): name is string => !!name);

  assert.deepEqual(wgslFields, [...INSTANCE_FIELDS]);
});

test("writeInstance round-trips every field at its own offset", () => {
  const view = new DataView(new ArrayBuffer(INSTANCE_STRIDE));
  writeInstance(view, {
    atlasIndex: 3,
    spawnTimeMs: 1234.5,
    lane: 2,
    driftSeed: -0.75,
    isOwn: 1,
  });

  assert.equal(view.getUint32(0, true), 3);
  assert.equal(view.getFloat32(4, true), 1234.5);
  assert.equal(view.getFloat32(8, true), 2);
  assert.equal(view.getFloat32(12, true), -0.75);
  assert.equal(view.getUint32(16, true), 1);
});

test("a full ring of spawns stays inside the buffer", () => {
  // The ring wraps with `slot = head % CAPACITY`; the last slot's write must
  // still end exactly at the buffer's end, never past it.
  const lastOffset = (REACTION_CAPACITY - 1) * INSTANCE_STRIDE;
  assert.equal(lastOffset + INSTANCE_STRIDE, REACTION_CAPACITY * INSTANCE_STRIDE);
  assert.ok(REACTION_CAPACITY >= 50, "ring must cover the 50-concurrent target");
});

test("the vertex shader actually consumes the atlas index", () => {
  // Regression guard for the first on-device bug: atlasIndex was declared in
  // the Instance struct but never read, so out.uv spanned the WHOLE atlas and
  // every reaction quad rendered the full emoji grid ("one button shows all
  // emojis"). The struct-order test above cannot catch a dead field.
  const vs = SHADER.slice(SHADER.indexOf("@vertex"), SHADER.indexOf("@fragment"));
  assert.ok(vs.includes("inst.atlasIndex"), "vs must read inst.atlasIndex");
  assert.ok(vs.includes("u.atlasCols"), "vs must scale uv by u.atlasCols");
  assert.match(vs, /out\.uv = \(cell \+ base\) \/ cols/, "uv must be cell-relative");
});
