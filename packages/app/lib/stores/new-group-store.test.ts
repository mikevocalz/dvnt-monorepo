import { test } from "node:test";
import assert from "node:assert/strict";
import { useNewGroupStore } from "./new-group-store.ts";

test("group chat selection supports more than four members and still toggles uniquely", () => {
  useNewGroupStore.getState().reset();
  for (let id = 1; id <= 8; id++) {
    assert.equal(useNewGroupStore.getState().toggleUser({ id: String(id), name: `Person ${id}`, username: `person${id}`, avatar: "" }), true);
  }
  assert.equal(useNewGroupStore.getState().selectedUsers.length, 8);
  useNewGroupStore.getState().toggleUser({ id: "4", name: "Person 4", username: "person4", avatar: "" });
  assert.equal(useNewGroupStore.getState().selectedUsers.length, 7);
  assert.equal(useNewGroupStore.getState().isSelected("4"), false);
  useNewGroupStore.getState().reset();
  assert.equal(useNewGroupStore.getState().isCreating, false);
});
