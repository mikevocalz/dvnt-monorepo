import assert from "node:assert/strict";
import { test } from "node:test";
import { bindRoomSnapshotChanges, createRoomSnapshotSync } from "./room-snapshot-sync.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a join read invalidated by a later leave never restores the departed member", async () => {
  const loads: ReturnType<typeof deferred<string[]>>[] = [];
  const snapshots: string[][] = [];
  const sync = createRoomSnapshotSync({
    load: () => { const load = deferred<string[]>(); loads.push(load); return load.promise; },
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });
  sync.invalidate();
  sync.invalidate();
  sync.invalidate();
  assert.equal(loads.length, 1, "rapid events coalesce behind the in-flight snapshot");
  loads[0]!.resolve(["host", "departed"]);
  await settle();
  assert.deepEqual(snapshots, []);
  assert.equal(loads.length, 2);
  loads[1]!.resolve(["host"]);
  await settle();
  assert.deepEqual(snapshots, [["host"]]);
  sync.stop();
});

test("cleanup prevents late snapshot and error callbacks", async () => {
  for (const fail of [false, true]) {
    const load = deferred<string[]>();
    const calls: unknown[] = [];
    const sync = createRoomSnapshotSync({ load: () => load.promise, onSnapshot: (x) => calls.push(x), onError: (x) => calls.push(x) });
    sync.invalidate();
    sync.stop();
    if (fail) load.reject(new Error("offline"));
    else load.resolve(["host"]);
    sync.invalidate();
    await settle();
    assert.deepEqual(calls, []);
  }
});

test("a failed snapshot preserves state and retries without waiting for another event", async () => {
  let reads = 0;
  const error = new Error("network unavailable");
  const errors: unknown[] = [];
  const snapshots: string[][] = [];
  let recovered!: () => void;
  const recovery = new Promise<void>((resolve) => { recovered = resolve; });
  const sync = createRoomSnapshotSync({
    load: async () => { if (++reads === 1) throw error; return ["host", "guest"]; },
    onSnapshot: (snapshot) => { snapshots.push(snapshot); recovered(); },
    onError: (error) => errors.push(error),
    retryMs: 1,
  });
  sync.invalidate();
  await recovery;
  sync.stop();
  assert.deepEqual(errors, [error]);
  assert.deepEqual(snapshots, [["host", "guest"]]);
  assert.equal(reads, 2);
});

test("room inserts/updates stay filtered; primary-key-only deletes invalidate safely", () => {
  const bindings: { config: any; callback: (payload: any) => void }[] = [];
  const channel = { on(_kind: string, config: any, callback: (payload: any) => void) { bindings.push({ config, callback }); return this; } };
  let reloads = 0;
  bindRoomSnapshotChanges(channel as any, "room_comments", "fixture-room", () => reloads++);
  assert.deepEqual(bindings.map(({ config }) => [config.event, config.filter]), [
    ["INSERT", "room_id=eq.fixture-room"],
    ["UPDATE", "room_id=eq.fixture-room"],
    ["DELETE", undefined],
  ]);
  bindings[2]!.callback({ old: { id: 10 } });
  bindings[2]!.callback({ old: { id: 11, room_id: "fixture-room" } });
  bindings[2]!.callback({ old: { id: 12, room_id: "other-room" } });
  assert.equal(reloads, 2);
});

test("fallback polling recovers silent realtime loss and stops with the consumer", async () => {
  let reads = 0;
  let polled!: () => void;
  const nextPoll = new Promise<void>((resolve) => { polled = resolve; });
  const snapshots: number[] = [];
  const sync = createRoomSnapshotSync({
    load: async () => ++reads,
    onSnapshot: (snapshot) => { snapshots.push(snapshot); if (snapshot === 2) polled(); },
    pollMs: 2,
  });
  sync.invalidate();
  await nextPoll;
  sync.stop();
  const stoppedAt = reads;
  await new Promise<void>((resolve) => setTimeout(resolve, 8));
  assert.deepEqual(snapshots, [1, 2]);
  assert.equal(reads, stoppedAt);
});
