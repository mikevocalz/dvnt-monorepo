import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRoomLifecycleWatcher,
  ROOM_LIFECYCLE_POLL_MS,
  ROOM_LIFECYCLE_READ_TIMEOUT_MS,
} from "./room-lifecycle.ts";
import type { RoomLifecycleSnapshot, RoomLifecycleSource } from "./room-lifecycle.ts";
import { createRoomLifecycleSource } from "./room-lifecycle-source.ts";

// No production room, join, token, media, or message APIs are used here.
const roomId = "00000000-0000-4000-8000-000000000001";
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function timers() {
  const pending = new Map<() => void, number>();
  return {
    schedule(callback: () => void, delay: number) {
      pending.set(callback, delay);
      return () => { pending.delete(callback); };
    },
    fire(delay: number) {
      for (const [callback, due] of [...pending]) {
        if (due !== delay || !pending.has(callback)) continue;
        pending.delete(callback);
        callback();
      }
    },
    count: () => pending.size,
  };
}
function fixtureBackend() {
  let snapshot: RoomLifecycleSnapshot = { status: "open", endedAt: null };
  let online = true;
  const listeners = new Set<Parameters<RoomLifecycleSource["subscribe"]>[0]>();
  const resume = new Set<() => void>();
  let reads = 0;
  let disposed = 0;
  const source: RoomLifecycleSource = {
    async load() {
      reads++;
      if (!online) throw new Error("fixture offline");
      return { ...snapshot };
    },
    subscribe(callbacks) {
      listeners.add(callbacks);
      return () => { disposed++; listeners.delete(callbacks); };
    },
    subscribeResume(check) {
      resume.add(check);
      return () => { disposed++; resume.delete(check); };
    },
  };
  return {
    source,
    end(deliverRow = true) {
      snapshot = { status: "ended", endedAt: "2026-10-13T00:00:00Z" };
      // Model membership rows already left and no room_ended event delivered.
      if (deliverRow) for (const listener of [...listeners]) listener.onSnapshot(snapshot);
    },
    staleOpen() { for (const listener of [...listeners]) listener.onSnapshot({ status: "open" }); },
    reconnect() { for (const listener of [...listeners]) listener.onReconnect(); },
    foreground() { for (const check of [...resume]) check(); },
    setOnline(value: boolean) { online = value; },
    reads: () => reads,
    disposed: () => disposed,
  };
}

test("no reads, realtime, timers, or callbacks before admission and identity", () => {
  for (const identity of [
    { enabled: false, roomId, userId: "guest" },
    { enabled: true, roomId: undefined, userId: "guest" },
    { enabled: true, roomId, userId: undefined },
  ]) {
    const backend = fixtureBackend();
    const clock = timers();
    let ended = 0;
    const watcher = createRoomLifecycleWatcher({ ...identity, source: backend.source, schedule: clock.schedule, onEnded: () => ended++ });
    watcher.checkNow();
    watcher.notifyEnded();
    watcher.stop();
    assert.equal(backend.reads(), 0);
    assert.equal(backend.disposed(), 0);
    assert.equal(clock.count(), 0);
    assert.equal(ended, 0);
  }
});

test("host end reaches multiple clients through the room row after all memberships left", async () => {
  const backend = fixtureBackend();
  const stops = [0, 0, 0];
  const clocks = stops.map(() => timers());
  const watchers = stops.map((_, index) => createRoomLifecycleWatcher({
    enabled: true, roomId, userId: `fixture-member-${index}`,
    source: backend.source, schedule: clocks[index]!.schedule,
    onEnded: () => { stops[index]++; },
  }));
  await settle();
  backend.end();
  backend.end();
  backend.staleOpen();
  watchers.forEach((watcher) => { watcher.notifyEnded(); watcher.checkNow(); watcher.stop(); });
  assert.deepEqual(stops, [1, 1, 1]);
  assert.equal(backend.disposed(), 6, "room and foreground listeners each disposed once per client");
  assert.ok(watchers.every((watcher) => watcher.isEnded()));
  assert.ok(clocks.every((clock) => clock.count() === 0));
});

test("missed realtime end is recovered on reconnect, foreground, and periodic fallback", async () => {
  for (const trigger of ["reconnect", "foreground", "poll"] as const) {
    const backend = fixtureBackend();
    const clock = timers();
    let ended = 0;
    const watcher = createRoomLifecycleWatcher({ enabled: true, roomId, userId: "guest", source: backend.source, schedule: clock.schedule, onEnded: () => ended++ });
    await settle();
    backend.end(false);
    assert.equal(ended, 0);
    if (trigger === "poll") clock.fire(ROOM_LIFECYCLE_POLL_MS);
    else backend[trigger]();
    await settle();
    assert.equal(ended, 1, trigger);
    assert.equal(backend.reads(), 2);
    watcher.stop();
  }
});

test("offline read failure preserves state, then foreground recovery sees persisted end", async () => {
  const backend = fixtureBackend();
  const clock = timers();
  const errors: unknown[] = [];
  let ended = 0;
  const watcher = createRoomLifecycleWatcher({ enabled: true, roomId, userId: "guest", source: backend.source, schedule: clock.schedule, onError: (error) => errors.push(error), onEnded: () => ended++ });
  await settle();
  backend.setOnline(false);
  backend.end(false);
  clock.fire(ROOM_LIFECYCLE_POLL_MS);
  await settle();
  assert.equal(errors.length, 1);
  assert.equal(ended, 0);
  backend.setOnline(true);
  backend.foreground();
  await settle();
  assert.equal(ended, 1);
  watcher.stop();
});

test("a stale open read cannot resurrect a terminal end or repeat cleanup", async () => {
  const backend = fixtureBackend();
  const clock = timers();
  const read = deferred<RoomLifecycleSnapshot>();
  let ended = 0;
  const watcher = createRoomLifecycleWatcher({ enabled: true, roomId, userId: "guest", source: { ...backend.source, load: () => read.promise }, schedule: clock.schedule, onEnded: () => ended++ });
  backend.end();
  read.resolve({ status: "open" });
  await settle();
  watcher.notifyEnded();
  watcher.stop();
  assert.equal(ended, 1);
  assert.equal(backend.disposed(), 2);
  assert.equal(clock.count(), 0);
});

test("reconnect during a stale in-flight read forces a new authoritative read", async () => {
  const backend = fixtureBackend();
  const clock = timers();
  const first = deferred<RoomLifecycleSnapshot>();
  let loads = 0;
  let ended = 0;
  const watcher = createRoomLifecycleWatcher({ enabled: true, roomId, userId: "guest", source: { ...backend.source, load: (signal) => ++loads === 1 ? first.promise : backend.source.load(signal) }, schedule: clock.schedule, onEnded: () => ended++ });
  backend.end(false);
  backend.reconnect();
  first.resolve({ status: "open" });
  await settle();
  assert.equal(loads, 2);
  assert.equal(ended, 1);
  watcher.stop();
});

test("unmount aborts a pending read and suppresses late callbacks from the old room", async () => {
  const backend = fixtureBackend();
  const clock = timers();
  const pending = deferred<RoomLifecycleSnapshot>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const watcher = createRoomLifecycleWatcher({ enabled: true, roomId, userId: "guest", source: { ...backend.source, load: (nextSignal) => { signal = nextSignal; return pending.promise; } }, schedule: clock.schedule, onEnded: () => calls++, onError: () => calls++ });
  watcher.stop();
  watcher.stop();
  pending.resolve({ status: "ended" });
  backend.reconnect();
  await settle();
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 0);
  assert.equal(backend.disposed(), 2);
  assert.equal(clock.count(), 0);
});

test("a hung network read times out and does not block recovery forever", async () => {
  const backend = fixtureBackend();
  const clock = timers();
  let loads = 0;
  let ended = 0;
  const errors: unknown[] = [];
  const watcher = createRoomLifecycleWatcher({ enabled: true, roomId, userId: "guest", source: { ...backend.source, load: (signal) => ++loads === 1 ? new Promise(() => {}) : backend.source.load(signal) }, schedule: clock.schedule, onEnded: () => ended++, onError: (error) => errors.push(error) });
  clock.fire(ROOM_LIFECYCLE_READ_TIMEOUT_MS);
  await settle();
  assert.equal(errors.length, 1);
  backend.end(false);
  clock.fire(ROOM_LIFECYCLE_POLL_MS);
  await settle();
  assert.equal(ended, 1);
  watcher.stop();
});

test("realtime subscribe failure still polls persisted state", async () => {
  const backend = fixtureBackend();
  const clock = timers();
  let ended = 0;
  backend.end(false);
  const watcher = createRoomLifecycleWatcher({ enabled: true, roomId, userId: "guest", source: { ...backend.source, subscribe: () => { throw new Error("socket unavailable"); } }, schedule: clock.schedule, onEnded: () => ended++ });
  await settle();
  assert.equal(ended, 1);
  assert.equal(clock.count(), 0);
  watcher.stop();
});

test("source reads only persisted room lifecycle fields and recovers on SUBSCRIBED", async () => {
  for (const id of [roomId, "42"]) {
    const calls: unknown[][] = [];
    let rowCallback!: (payload: { new: unknown }) => void;
    let statusCallback!: (status: string) => void;
    const channel = {
      on(kind: string, config: unknown, callback: typeof rowCallback) { calls.push(["on", kind, config]); rowCallback = callback; return this; },
      subscribe(callback: typeof statusCallback) { statusCallback = callback; return this; },
    };
    const query = {
      select(fields: string) { calls.push(["select", fields]); return this; },
      eq(field: string, value: string) { calls.push(["eq", field, value]); return this; },
      abortSignal(signal: AbortSignal) { calls.push(["abortSignal", signal]); return this; },
      async maybeSingle() { return { data: { status: "ended", ended_at: "fixture-date" }, error: null }; },
    };
    const client = {
      from(table: string) { calls.push(["from", table]); return query; },
      removeChannel(value: unknown) { calls.push(["removeChannel", value]); },
    };
    const source = createRoomLifecycleSource({ roomId: id, userId: "fixture-guest", client: client as any, createChannel: () => channel as any });
    const signal = new AbortController().signal;
    assert.deepEqual(await source.load(signal), { status: "ended", endedAt: "fixture-date" });
    let reconnects = 0;
    const snapshots: RoomLifecycleSnapshot[] = [];
    const dispose = source.subscribe({ onReconnect: () => reconnects++, onSnapshot: (value) => snapshots.push(value) });
    statusCallback("SUBSCRIBED");
    statusCallback("CHANNEL_ERROR");
    statusCallback("SUBSCRIBED");
    rowCallback({ new: { status: "ended", ended_at: "fixture-date" } });
    rowCallback({ new: {} });
    assert.equal(reconnects, 2);
    assert.deepEqual(snapshots, [{ status: "ended", endedAt: "fixture-date" }]);
    assert.deepEqual(calls.slice(0, 4), [["from", "video_rooms"], ["select", "status, ended_at"], ["eq", id === roomId ? "uuid" : "id", id], ["abortSignal", signal]]);
    assert.deepEqual(calls[4], ["on", "postgres_changes", { event: "UPDATE", schema: "public", table: "video_rooms", filter: `${id === roomId ? "uuid" : "id"}=eq.${id}` }]);
    dispose();
    assert.equal(calls.filter((call) => call[0] === "removeChannel").length, 1);
  }
});

test("one broken observer cleanup cannot prevent terminal media shutdown", () => {
  const backend = fixtureBackend();
  const clock = timers();
  let ended = 0;
  const errors: unknown[] = [];
  const watcher = createRoomLifecycleWatcher({
    enabled: true, roomId, userId: "guest", schedule: clock.schedule,
    source: { ...backend.source, subscribe: () => () => { throw new Error("dispose failed"); } },
    onEnded: () => ended++, onError: (error) => errors.push(error),
  });
  watcher.notifyEnded();
  watcher.stop();
  assert.equal(ended, 1);
  assert.equal(errors.length, 1);
  assert.equal(backend.disposed(), 1, "remaining observer was also cleaned up");
  assert.equal(clock.count(), 0);
});

test("a successful missing-row read is inconclusive and is retried", async () => {
  const backend = fixtureBackend();
  const clock = timers();
  let loads = 0;
  let ended = 0;
  const watcher = createRoomLifecycleWatcher({
    enabled: true, roomId, userId: "guest", schedule: clock.schedule,
    source: { ...backend.source, load: (signal) => ++loads === 1 ? Promise.resolve(null) : backend.source.load(signal) },
    onEnded: () => ended++,
  });
  await settle();
  assert.equal(ended, 0);
  backend.end(false);
  clock.fire(ROOM_LIFECYCLE_POLL_MS);
  await settle();
  assert.equal(ended, 1);
  watcher.stop();
});

test("missing platform resume adapter does not disable polling or initial read", async () => {
  const backend = fixtureBackend();
  const clock = timers();
  let ended = 0;
  backend.end(false);
  const watcher = createRoomLifecycleWatcher({
    enabled: true, roomId, userId: "guest", schedule: clock.schedule,
    source: { ...backend.source, subscribeResume: () => { throw new Error("no platform events"); } },
    onEnded: () => ended++,
  });
  await settle();
  assert.equal(ended, 1);
  assert.equal(clock.count(), 0);
  watcher.stop();
});

test("persisted closed legacy rooms are terminal, matching server token admission", async () => {
  const backend = fixtureBackend();
  const clock = timers();
  let ended = 0;
  const watcher = createRoomLifecycleWatcher({
    enabled: true, roomId, userId: "guest", schedule: clock.schedule,
    source: { ...backend.source, load: async () => ({ status: "closed" }) },
    onEnded: () => ended++,
  });
  await settle();
  assert.equal(ended, 1);
  assert.equal(watcher.isEnded(), true);
  watcher.stop();
});
