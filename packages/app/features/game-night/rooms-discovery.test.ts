import assert from "node:assert/strict";
import test from "node:test";
import type { WatchableRoom } from "./rooms-api";
import { partitionRooms, roomMatchesHandle } from "./rooms-discovery";

function room(overrides: Partial<WatchableRoom> = {}): WatchableRoom {
  return {
    roomCode: "ABC123",
    status: "playing",
    hostName: "PrinceOfDemocracy",
    hostAvatar: null,
    playerCount: 4,
    watcherCount: 2,
    startedAt: "2026-10-05T20:00:00.000Z",
    seatAvatars: [
      { id: "1", name: "qmsavwoir", avatar: null },
      { id: "2", name: "Addictive Clam20", avatar: null },
    ],
    ...overrides,
  };
}

test("search matches host and seated handles case-insensitively", () => {
  assert.equal(roomMatchesHandle(room(), "prince"), true);
  assert.equal(roomMatchesHandle(room(), "CLAM"), true);
  assert.equal(roomMatchesHandle(room(), "nobody"), false);
});

test("playing rooms can be watched while open-seat rooms can be joined", () => {
  const full = room({ roomCode: "FULL", playerCount: 4 });
  const open = room({ roomCode: "OPEN", playerCount: 2 });
  const waiting = room({ roomCode: "WAIT", status: "open", playerCount: 1 });
  const result = partitionRooms([full, open, waiting]);
  assert.deepEqual(result.watch.map((r) => r.roomCode), ["FULL", "OPEN"]);
  assert.deepEqual(result.join.map((r) => r.roomCode), ["OPEN", "WAIT"]);
});
