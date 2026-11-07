import assert from "node:assert/strict";
import test from "node:test";
import { lynkRoomAppUrl, lynkRoomShareUrl, normalizeLynkRoomId } from "./room-links.ts";

test("shared and app-only URLs retain only the exact room identity", () => {
  for (const id of ["8e1644ac-ef86-42d0-b851-b063d12e3442", "room-a", "ROOM_42", "123"]) {
    assert.equal(normalizeLynkRoomId(id), id);
    const shared = new URL(lynkRoomShareUrl(id)!);
    assert.equal(shared.origin, "https://dvntapp.live");
    assert.equal(shared.pathname, `/sneaky-lynk/room/${id}`);
    assert.equal(shared.search, "");
    assert.equal(shared.hash, "");
    assert.equal(lynkRoomAppUrl(id), `dvnt://sneaky-lynk/room/${id}`);
  }
});

test("invalid or ambiguous IDs never become links or another route", () => {
  for (const id of [undefined, null, [], ["room-a", "room-b"], {}, 42, "", ".", "..", "/room-a",
    "room/a", "room\\a", "room?isHost=1", "room#other", "%2e%2e", "room%252fother", " room ",
    "room\n", "room\u0000", "room\u2028", "a".repeat(129)]) {
    assert.equal(normalizeLynkRoomId(id), null);
    assert.equal(lynkRoomShareUrl(id), null);
    assert.equal(lynkRoomAppUrl(id), null);
  }
});

test("local practice spaces cannot emit misleading invitations", () => {
  for (const id of ["my-room", "space-a", "space-preview"]) {
    assert.equal(normalizeLynkRoomId(id), id, "local navigation remains valid");
    assert.equal(lynkRoomShareUrl(id), null);
    assert.equal(lynkRoomAppUrl(id), null);
  }
});
