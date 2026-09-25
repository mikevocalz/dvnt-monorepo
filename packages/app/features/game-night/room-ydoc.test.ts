import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import {
  base64ToBytes,
  bytesToBase64,
  acquireRoomYDoc,
  releaseRoomYDoc,
  getRoomYDocEntry,
} from "./room-ydoc.ts";

test("bytesToBase64 / base64ToBytes roundtrip", () => {
  const doc = new Y.Doc();
  doc.getMap("state").set("json", { hello: "world" });
  const update = Y.encodeStateAsUpdate(doc);

  const b64 = bytesToBase64(update);
  assert.equal(typeof b64, "string");
  assert.ok(b64.length > 0);

  const restored = base64ToBytes(b64);
  assert.deepEqual(restored, update);
});

test("base64 roundtrip handles a large update without stack overflow", () => {
  const doc = new Y.Doc();
  const map = doc.getMap("state");
  // Produce a >64 KiB update to exercise chunked encoding.
  for (let i = 0; i < 2000; i++) {
    map.set(String(i), "x".repeat(100));
  }
  const update = Y.encodeStateAsUpdate(doc);
  assert.ok(update.length > 0x8000, "test update should exceed chunk size");

  const b64 = bytesToBase64(update);
  const restored = base64ToBytes(b64);
  assert.deepEqual(restored, update);
});

test("registry acquire/release refcount and removes the doc on last release", () => {
  const roomId = "room-abc";

  const entry1 = acquireRoomYDoc(roomId);
  assert.equal(getRoomYDocEntry(roomId)?.refs, 1);

  const entry2 = acquireRoomYDoc(roomId);
  assert.equal(entry2.doc, entry1.doc, "same room should reuse the same doc");
  assert.equal(getRoomYDocEntry(roomId)?.refs, 2);

  releaseRoomYDoc(roomId);
  assert.equal(getRoomYDocEntry(roomId)?.refs, 1);

  releaseRoomYDoc(roomId);
  assert.equal(getRoomYDocEntry(roomId), undefined, "registry entry removed");
});

test("registry keeps independent docs for different rooms", () => {
  const a = acquireRoomYDoc("room-a");
  const b = acquireRoomYDoc("room-b");
  assert.notEqual(a.doc, b.doc);
  assert.equal(getRoomYDocEntry("room-a")?.refs, 1);
  assert.equal(getRoomYDocEntry("room-b")?.refs, 1);
  releaseRoomYDoc("room-a");
  releaseRoomYDoc("room-b");
  assert.equal(getRoomYDocEntry("room-a"), undefined);
  assert.equal(getRoomYDocEntry("room-b"), undefined);
});
