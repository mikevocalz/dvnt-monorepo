/**
 * `safeMetadata` runs on the error path, at boot, on a payload built from a
 * native crash record. Everything it touches is hostile: cyclic objects, huge
 * stacks, values `JSON.stringify` refuses. A throw here would be an error
 * reporter that crashes the app it reports on, so the contract is that it
 * always returns an object.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { safeMetadata, MAX_METADATA_CHARS } from "./report-issue.ts";

test("passes a small payload through unchanged", () => {
  const detail = { kind: "js", message: "boom", count: 3, nested: { a: [1, 2] } };
  assert.deepEqual(safeMetadata(detail), detail);
});

test("a cyclic payload returns a marker instead of throwing", () => {
  const cyclic: Record<string, unknown> = { name: "TypeError" };
  cyclic.self = cyclic;
  assert.deepEqual(safeMetadata(cyclic), { unserializable: true });
});

test("an oversized payload is truncated, not dropped", () => {
  const result = safeMetadata({ stack: "x".repeat(MAX_METADATA_CHARS * 2) });
  assert.equal(result.truncated, true);
  assert.equal(typeof result.head, "string");
  assert.equal((result.head as string).length, MAX_METADATA_CHARS);
  // The original size is the useful part of a truncated record — it says how
  // much was lost, which is how you find the field that needs a cap upstream.
  assert.ok((result.originalChars as number) > MAX_METADATA_CHARS);
});

test("values JSON drops are simply absent, and the row still sends", () => {
  const result = safeMetadata({ ok: 1, gone: undefined, alsoGone: () => null });
  assert.equal(result.ok, 1);
  assert.ok(!("gone" in result));
  assert.ok(!("alsoGone" in result));
});
