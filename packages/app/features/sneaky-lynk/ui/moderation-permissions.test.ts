import test from "node:test";
import assert from "node:assert/strict";
import {
  participantModeration,
  isRoomModerator,
} from "./moderation-permissions.ts";

for (const actor of [
  "host",
  "co-host",
  "moderator",
  "participant",
  "speaker",
  "listener",
  "unknown",
  undefined,
]) {
  test(`${actor ?? "missing"} moderation matches server hierarchy`, () => {
    const allowed = ["host", "co-host", "moderator"].includes(actor ?? "");
    assert.equal(isRoomModerator(actor), allowed);
    for (const target of [
      "host",
      "co-host",
      "moderator",
      "participant",
      "listener",
    ]) {
      const caps = participantModeration(actor, "me", "other", target);
      assert.equal(caps.mute, allowed && target !== "host");
      assert.equal(caps.changeRole, actor === "host" && target !== "host");
      assert.equal(
        caps.remove,
        allowed &&
          target !== "host" &&
          !(actor === "moderator" && target === "moderator"),
      );
      assert.deepEqual(participantModeration(actor, "me", "me", target), {
        mute: false,
        changeRole: false,
        remove: false,
      });
      assert.deepEqual(
        participantModeration(actor, undefined, "other", target),
        { mute: false, changeRole: false, remove: false },
      );
    }
  });
}
