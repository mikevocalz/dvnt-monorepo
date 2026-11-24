import test from "node:test";
import assert from "node:assert/strict";
import { getEditableMediaIds, toggleMediaRemoval } from "./edit-post-media.ts";

test("uses stable ordered rows only and refuses incomplete or ambiguous identity", () => {
  assert.deepEqual(getEditableMediaIds([{ mediaId: "still", order: 0 }, { mediaId: "motion", order: 2 }]), ["still", "motion"]);
  assert.deepEqual(getEditableMediaIds([{ mediaId: "still", order: 0 }, { order: 2 }]), []);
  assert.deepEqual(getEditableMediaIds([{ mediaId: "still", order: 0 }, { mediaId: "motion", order: 0 }]), []);
});

test("supports undo, preserves original identity across changes and retains a final item", () => {
  const ordered = ["a", "b", "c"];
  const first = toggleMediaRemoval(ordered, null, "b");
  assert.deepEqual(first, { expectedIds: ordered, ids: ["b"] });
  assert.deepEqual(toggleMediaRemoval(ordered, first, "b"), null);
  assert.equal(toggleMediaRemoval(["c", "a", "b"], first, "a"), first);
  const second = toggleMediaRemoval(ordered, first, "a");
  assert.deepEqual(second, { expectedIds: ordered, ids: ["a", "b"] });
  assert.deepEqual(toggleMediaRemoval(ordered, second, "c"), second);
});
