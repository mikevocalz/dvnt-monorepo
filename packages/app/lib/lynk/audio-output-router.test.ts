import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioOutputRouter, type AudioOutputState } from "./audio-output-router.ts";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function context(sinkId = "") {
  const calls: { id: string; resolve: () => void; reject: () => void }[] = [];
  const value = { sinkId, state: "running", setSinkId(id: string) {
    return new Promise<void>((resolve, reject) => calls.push({ id, resolve: () => { value.sinkId = id; resolve(); }, reject: () => reject(new Error("private system detail")) }));
  } };
  return { value, calls };
}
function fixture() {
  let state: AudioOutputState;
  const router = new AudioOutputRouter(next => { state = next; });
  return { router, state: () => state ?? router.getSnapshot() };
}

test("prejoin choice is pending until an actual receiver accepts the sink", async () => {
  const f = fixture(), c = context(), ready: boolean[] = [];
  f.router.select("headphones", "My headphones");
  assert.equal(f.state().phase, "waiting");
  const remove = f.router.register(c.value, value => ready.push(value));
  await tick();
  assert.equal(f.state().phase, "applying"); assert.equal(ready.at(-1), false);
  assert.deepEqual(c.calls.map(call => call.id), ["headphones"]);
  c.calls[0].resolve(); await tick();
  assert.equal(ready.at(-1), true); assert.equal(f.state().phase, "ready");
  remove(); assert.equal(f.state().phase, "waiting"); f.router.dispose();
});

test("latest output wins serialized writes and obsolete success never unmutes", async () => {
  const f = fixture(), c = context(), ready: boolean[] = [];
  f.router.register(c.value, value => ready.push(value)); await tick();
  f.router.select("a", "A"); await tick();
  f.router.select("b", "B"); await tick();
  assert.equal(c.calls.length, 1);
  c.calls[0].resolve(); await tick();
  assert.equal(ready.at(-1), false); assert.equal(f.state().phase, "applying");
  assert.deepEqual(c.calls.map(call => call.id), ["a", "b"]);
  c.calls[1].resolve(); await tick(); assert.equal(f.state().label, "B");
  assert.equal(f.state().phase, "ready"); assert.equal(ready.at(-1), true); f.router.dispose();
});

test("returning to the currently matching default stays gated behind pending writes", async () => {
  const f = fixture(), c = context(); let ready = false;
  f.router.register(c.value, value => { ready = value; }); await tick(); assert.equal(ready, true);
  f.router.select("headphones", "Headphones"); await tick();
  f.router.select("", "System default"); await tick();
  assert.equal(c.value.sinkId, ""); assert.equal(ready, false, "matching current sink does not settle an older write");
  c.calls[0].resolve(); await tick();
  assert.equal(c.value.sinkId, "headphones"); assert.equal(ready, false);
  assert.equal(c.calls[1].id, ""); c.calls[1].resolve(); await tick();
  assert.equal(ready, true); assert.equal(c.value.sinkId, ""); f.router.dispose();
});

test("failure across receivers restores default before announcing fallback", async () => {
  const f = fixture(), a = context(), b = context();
  let aReady = false, bReady = false;
  f.router.register(a.value, value => { aReady = value; });
  f.router.register(b.value, value => { bReady = value; }); await tick();
  f.router.select("usb", "USB"); await tick();
  a.calls[0].resolve(); b.calls[0].reject(); await tick();
  assert.equal(f.state().deviceId, ""); assert.equal(f.state().phase, "applying");
  assert.deepEqual(a.calls.map(call => call.id), ["usb", ""]);
  a.calls[1].resolve(); await tick();
  assert.equal(f.state().phase, "default"); assert.equal(aReady && bReady, true);
  assert.match(f.state().message!, /now using system default/); assert.doesNotMatch(f.state().message!, /private system detail/);
  f.router.dispose();
});

test("failed default restoration stays explicit and retry can recover", async () => {
  const f = fixture(), c = context("old"); let ready = false;
  f.router.select("new", "New"); f.router.register(c.value, value => { ready = value; }); await tick();
  c.calls[0].reject(); await tick(); c.calls[1].reject(); await tick();
  assert.equal(f.state().phase, "error"); assert.equal(ready, false); assert.match(f.state().message!, /audio is paused/);
  f.router.select("", "System default"); await tick(); c.calls[2].resolve(); await tick();
  assert.equal(f.state().phase, "default"); assert.equal(ready, true); f.router.dispose();
});

test("replacement receivers inherit choice; detached failures are ignored", async () => {
  const f = fixture(), a = context(), b = context();
  f.router.select("headphones", "Headphones"); const remove = f.router.register(a.value, () => {}); await tick();
  remove(); f.router.register(b.value, () => {}); await tick();
  a.calls[0].reject(); await tick(); assert.equal(f.state().deviceId, "headphones");
  b.calls[0].resolve(); await tick(); assert.equal(f.state().phase, "ready"); f.router.dispose();
});

test("reset/disposal ignores an in-flight route without closing SDK contexts", async () => {
  const f = fixture(), c = context(); let ready = false;
  f.router.select("usb", "USB"); f.router.register(c.value, value => { ready = value; }); await tick();
  f.router.dispose(); c.calls[0].resolve(); await tick(); assert.equal(ready, false); assert.equal(c.value.state, "running");
  assert.equal(f.state().phase, "applying");
});

test("room store reset serializes against an old router's in-flight context write", async () => {
  const old = fixture(), next = fixture(), c = context(); let ready = false;
  old.router.select("headphones", "Headphones"); old.router.register(c.value, () => {}); await tick();
  old.router.dispose(); next.router.register(c.value, value => { ready = value; }); await tick();
  assert.equal(ready, false); assert.equal(c.calls.length, 1);
  c.calls[0].resolve(); await tick(); assert.equal(ready, false); assert.equal(c.calls[1].id, "");
  c.calls[1].resolve(); await tick(); assert.equal(ready, true); assert.equal(c.value.sinkId, ""); next.router.dispose();
});

test("browsers without Web Audio sink routing keep default audio usable", async () => {
  const f = fixture(); let ready = false;
  f.router.register({ state: "running" }, value => { ready = value; }); await tick(); assert.equal(ready, true);
  f.router.select("unknown", "Unknown"); await tick(); await tick();
  assert.equal(f.state().deviceId, ""); assert.equal(ready, true); assert.match(f.state().message!, /system default/); f.router.dispose();
});

test("closed receivers cannot claim successful playback routing", async () => {
  const f = fixture(); f.router.select("usb", "USB");
  f.router.register({ state: "closed", setSinkId: async () => { throw new Error("must not run"); } }, () => {});
  await tick(); assert.equal(f.state().phase, "waiting"); f.router.dispose();
});

test("capability, explicit chooser cancellation, hotplug and stale inventory are safe", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const devices = new EventTarget() as EventTarget & { enumerateDevices: () => Promise<unknown[]>; selectAudioOutput: () => Promise<unknown> };
  let list = [{ kind: "audiooutput", deviceId: "usb", label: "USB" }];
  const picks: { resolve: (device: unknown) => void; reject: (error: unknown) => void }[] = [];
  devices.enumerateDevices = async () => list;
  devices.selectAudioOutput = () => new Promise((resolve, reject) => picks.push({ resolve, reject }));
  class AudioContext { async setSinkId() {} }
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: devices } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { AudioContext } });
  const f = fixture();
  try {
    const disconnect = f.router.connect(); await tick(); assert.equal(picks.length, 0); assert.equal(f.state().canChoose, true);
    const pending = f.router.choose(); assert.equal(picks.length, 1); f.router.cancelPicker(); picks[0].resolve({ deviceId: "late", label: "Late" }); await pending;
    assert.equal(f.state().deviceId, "");
    const choose = f.router.choose(); picks[1].resolve({ deviceId: "usb", label: "USB" }); await choose;
    assert.equal(f.state().deviceId, "usb"); assert.equal(f.state().phase, "waiting");
    const denied = f.router.choose(); picks[2].reject(Object.assign(new Error("secret"), { name: "NotAllowedError" })); await denied;
    assert.equal(f.state().deviceId, "usb"); assert.match(f.state().message!, /unchanged/);
    list = []; devices.dispatchEvent(new Event("devicechange")); await tick();
    assert.equal(f.state().deviceId, ""); assert.match(f.state().message!, /disconnected/); assert.equal(picks.length, 3);
    const stale = f.router.choose(); disconnect(); picks[3].resolve({ deviceId: "late", label: "Late" }); await stale; assert.equal(f.state().deviceId, "");
    const again = f.router.connect(); await tick();
    let resolveInventory!: (devices: unknown[]) => void;
    devices.enumerateDevices = () => new Promise(resolve => { resolveInventory = resolve; });
    const inventory = f.router.refresh(true); f.router.select("new", "New"); resolveInventory([]); await inventory;
    assert.equal(f.state().deviceId, "new", "old inventory must not undo a newer selection");
    const aba = f.router.refresh(true); f.router.select("other", "Other"); f.router.select("new", "New"); resolveInventory([]); await aba;
    assert.equal(f.state().deviceId, "new", "stale inventory must not undo A → B → A selection");
    again(); f.router.dispose();
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else Reflect.deleteProperty(globalThis, "navigator");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});
