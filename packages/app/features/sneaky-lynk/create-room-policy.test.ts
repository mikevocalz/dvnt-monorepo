import test from "node:test";
import assert from "node:assert/strict";
import { resolveCreatedRoomId, roomInviteeIds } from "./create-room-policy.ts";

test("creation prefers the confirmed UUID and accepts positive legacy integer IDs", () => {
  const uuid = "ab123456-1234-1234-1234-123456789012";
  assert.equal(resolveCreatedRoomId({ id: 123, uuid }), uuid);
  assert.equal(resolveCreatedRoomId({ id: 123 }), "123");
  assert.equal(resolveCreatedRoomId({ internalId: "17" }), "17");
  for (const room of [null, {}, { id: -1 }, { id: NaN }, { id: "space-123" }, { id: {} }, { id: "../wrong" }]) {
    assert.equal(resolveCreatedRoomId(room), "", "never invent a usable room ID");
  }
});

test("selected private invitees are sent once and public rooms never send invitations", () => {
  const invitees = [{ authId: "one" }, { authId: "one" }, { authId: "two" }, { authId: "" }];
  assert.deepEqual(roomInviteeIds(false, invitees), ["one", "two"]);
  assert.deepEqual(roomInviteeIds(true, invitees), []);
});
