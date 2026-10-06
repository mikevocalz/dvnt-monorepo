import assert from "node:assert/strict";
import test from "node:test";
import {
  createRoomReactionEvent,
  isRoomReactionEmoji,
  ROOM_REACTIONS,
} from "./room-reactions.ts";

test("supported room reactions are explicit and Rive-addressable", () => {
  assert.deepEqual(ROOM_REACTIONS, ["❤️", "😂", "🔥", "💀", "👀", "💯"]);
  assert.equal(isRoomReactionEmoji("🔥"), true);
  assert.equal(isRoomReactionEmoji("🙂"), false);

  const event = createRoomReactionEvent({
    id: "reaction-123",
    roomId: 7,
    userId: "u1",
    emoji: "🔥",
    isMine: true,
    seatIndex: 2,
  });

  assert.equal(event.kind, "fire");
  assert.equal(event.kindValue, 2);
  assert.equal(event.seatIndex, 2);
  assert.ok(event.lane >= 0 && event.lane <= 2);
  assert.equal(event.intensity, 1);
});

test("reaction intensity is clamped for the animation state machine", () => {
  assert.equal(
    createRoomReactionEvent({
      id: "a",
      roomId: 1,
      userId: "u",
      emoji: "💯",
      isMine: false,
      seatIndex: 99,
      intensity: 99,
    }).intensity,
    3,
  );
  assert.equal(
    createRoomReactionEvent({
      id: "b",
      roomId: 1,
      userId: "u",
      emoji: "❤️",
      isMine: false,
      seatIndex: 99,
    }).seatIndex,
    3,
  );
});
