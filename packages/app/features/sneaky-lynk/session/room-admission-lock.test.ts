import { test } from "node:test";
import assert from "node:assert/strict";
import { withRoomAdmissionLock } from "./room-admission-lock.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("new mounts cannot admit until old successful-response cleanup completes", async () => {
  const request = deferred();
  const cleanup = deferred();
  const cleanupStarted = deferred();
  const log: string[] = [];
  const oldMount = withRoomAdmissionLock("same-account", "same-room", async () => {
    log.push("old join");
    await request.promise;
    log.push("old cleanup");
    cleanupStarted.resolve();
    await cleanup.promise;
    log.push("old cleanup finished");
  });
  await Promise.resolve();
  request.resolve();
  await cleanupStarted.promise;
  const newMount = withRoomAdmissionLock("same-account", "same-room", async () => { log.push("new join"); return true; });
  await Promise.resolve();
  assert.deepEqual(log, ["old join", "old cleanup"]);
  cleanup.resolve();
  await oldMount;
  assert.equal(await newMount, true);
  assert.deepEqual(log, ["old join", "old cleanup", "old cleanup finished", "new join"]);
});

test("different accounts and rooms are independent and failures release their lane", async () => {
  const request = deferred();
  const old = withRoomAdmissionLock("a", "room-1", async () => { await request.promise; throw new Error("offline"); });
  const failed = assert.rejects(old, /offline/);
  assert.equal(await withRoomAdmissionLock("b", "room-1", async () => "other account"), "other account");
  assert.equal(await withRoomAdmissionLock("a", "room-2", async () => "other room"), "other room");
  let sent = false;
  const next = withRoomAdmissionLock("a", "room-1", async () => { sent = true; return "retried"; });
  await Promise.resolve();
  assert.equal(sent, false);
  request.resolve();
  await failed;
  assert.equal(await next, "retried");
});

test("queued cancelled mount rechecks its intent before dispatch", async () => {
  const cleanup = deferred();
  const old = withRoomAdmissionLock("a", "room", () => cleanup.promise);
  let current = true;
  let dispatched = false;
  const queued = withRoomAdmissionLock("a", "room", async () => {
    if (!current) return false;
    dispatched = true;
    return true;
  });
  current = false;
  cleanup.resolve();
  await old;
  assert.equal(await queued, false);
  assert.equal(dispatched, false);
});
