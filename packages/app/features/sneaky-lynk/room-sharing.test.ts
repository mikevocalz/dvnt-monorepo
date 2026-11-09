import assert from "node:assert/strict";
import test from "node:test";
import { roomShareCopy, shareRoomLink } from "./room-sharing.ts";

const data = { title: "Private room", text: "Open room", url: "https://dvntapp.live/sneaky-lynk/room/test" };
test("private link copy does not imply granting access", () => {
  assert.match(roomShareCopy("Private room", false).text, /requires access/);
  assert.match(roomShareCopy("Private room", false).confirmation, /Only people with access/);
  assert.match(roomShareCopy("Room").confirmation, /access rules still apply/);
});
test("shares using system sheet; dismissal never copies to clipboard", async () => {
  let copies = 0;
  const copy = async () => { copies++; };
  assert.equal(await shareRoomLink({ ...data, isCurrent: () => true, share: async payload => { assert.deepEqual(payload, data); }, copy }), "shared");
  assert.equal(await shareRoomLink({ ...data, isCurrent: () => true, share: async () => { throw { name: "AbortError" }; }, copy }), "cancelled");
  assert.equal(copies, 0);
});
test("fallback and asynchronous feedback require current room ownership", async () => {
  let current = true, copies = 0;
  assert.equal(await shareRoomLink({ ...data, isCurrent: () => current, share: async () => { current = false; throw Error("sheet failed"); }, copy: async () => { copies++; } }), "stale");
  assert.equal(copies, 0);
  current = true;
  assert.equal(await shareRoomLink({ ...data, isCurrent: () => current, copy: async text => { assert.equal(text, `${data.text}\n${data.url}`); current = false; copies++; } }), "stale");
  assert.equal(await shareRoomLink({ ...data, isCurrent: () => false, share: async () => { throw Error("must not run"); } }), "stale");
});
test("missing APIs and rejected clipboard are actionable failures", async () => {
  assert.equal(await shareRoomLink({ ...data, isCurrent: () => true }), "failed");
  assert.equal(await shareRoomLink({ ...data, isCurrent: () => true, copy: async () => { throw Error("denied"); } }), "failed");
  assert.equal(await shareRoomLink({ ...data, isCurrent: () => true, share: async () => { throw Error("unsupported"); }, copy: async () => {} }), "copied");
});
