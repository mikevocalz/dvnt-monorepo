import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
// Node 24 runs these tests; the app's older @types/node predates registerHooks.
const { registerHooks } = createRequire(import.meta.url)("node:module");

// Execute the production hooks with deterministic React/transport boundaries.
// No relay, browser permissions, camera or credentials are used by these tests.
class Hooks {
  slots: any[] = [];
  cursor = 0;
  dirty = false;
  pending: number[] = [];
  fn!: () => any;
  value: any;
  useState(initial: any) {
    const index = this.cursor++;
    const slot = this.slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
    return [slot.value, (next: any) => {
      const value = typeof next === "function" ? next(slot.value) : next;
      if (!Object.is(value, slot.value)) { slot.value = value; this.dirty = true; }
    }];
  }
  useRef(initial: any) {
    return (this.slots[this.cursor++] ??= { current: initial });
  }
  useMemo(fn: () => any, deps: any[]) {
    const index = this.cursor++;
    const slot = this.slots[index];
    if (!slot || changed(slot.deps, deps)) this.slots[index] = { value: fn(), deps };
    return this.slots[index].value;
  }
  useCallback(fn: any, deps: any[]) { return this.useMemo(() => fn, deps); }
  useEffect(effect: () => any, deps: any[]) {
    const index = this.cursor++;
    const old = this.slots[index];
    this.slots[index] = { ...old, effect, deps };
    if (!old || changed(old.deps, deps)) this.pending.push(index);
  }
  useSyncExternalStore(_subscribe: any, snapshot: () => any) { return snapshot(); }
  render(fn = this.fn) {
    this.fn = fn;
    let passes = 0;
    do {
      assert.ok(++passes < 30, "hook rerender loop");
      this.cursor = 0;
      this.dirty = false;
      (globalThis as any).__lynkHooks = this;
      this.value = fn();
      const pending = this.pending.splice(0);
      for (const index of pending) {
        const slot = this.slots[index];
        slot.cleanup?.();
        slot.cleanup = slot.effect();
      }
    } while (this.dirty);
    return this.value;
  }
  flush() { if (this.dirty) this.render(); return this.value; }
  replay() {
    const effects = this.slots.filter((slot) => slot?.effect);
    for (const slot of effects) slot.cleanup?.();
    for (const slot of effects) slot.cleanup = slot.effect();
    return this.flush();
  }
  unmount() { for (const slot of this.slots) slot.cleanup?.(); }
}
const changed = (a: any[] = [], b: any[] = []) => a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
class Signal {
  value: any;
  listeners = new Set<(value: any) => void>();
  constructor(value: any) { this.value = value; }
  set(value: any) { if (Object.is(value, this.value)) return; this.value = value; for (const callback of [...this.listeners]) callback(value); }
  peek() { return this.value; }
  subscribe(callback: (value: any) => void) { this.listeners.add(callback); return () => this.listeners.delete(callback); }
}
// Deterministic signal graph at the SDK boundary. Production still receives
// Getter-only outputs: mutations have to use the explicitly wired input Signals.
class Computed extends Signal {
  stops: (() => void)[] = [];
  closed = false;
  constructor(fn: (effect: any) => any) {
    super(undefined);
    const run = () => {
      if (this.closed) return;
      for (const stop of this.stops.splice(0)) stop();
      this.set(fn({ get: (signal: Signal) => { this.stops.push(signal.subscribe(run)); return signal.peek(); } }));
    };
    run(); resources.computeds.push(this);
  }
  close() { this.closed = true; for (const stop of this.stops.splice(0)) stop(); this.set(undefined); }
}
const resources = {
  connections: [] as any[], players: [] as any[], watches: [] as any[], devices: [] as any[],
  captures: [] as any[], encoders: [] as any[], computeds: [] as any[], publications: [] as any[],
  nativePublications: [] as any[], initialPaths: [] as string[],
  cameraOptions: [] as any[], microphoneOptions: [] as any[],
};
class Connection {
  props: any;
  closed = false;
  status = new Signal("connected");
  error = new Signal(undefined);
  bandwidth = new Signal({ allocator: "fixture" });
  routes = new Signal(new Map(resources.initialPaths.map((path) => [path, {}])));
  origin = new Signal({ broadcasts: () => this.routes });
  probe = new Signal(undefined);
  constructor(props: any) { this.props = props; resources.connections.push(this); }
  close() { this.closed = true; }
}
class WatchBroadcast {
  closed = false;
  constructor() { resources.watches.push(this); }
  close() { this.closed = true; }
}
class Player {
  props: any;
  closed = false;
  broadcast = new WatchBroadcast();
  video = { source: { out: { config: new Signal(undefined) } }, out: { frame: new Signal(undefined) } };
  constructor(props: any) {
    assert.ok(props.origin instanceof Signal);
    assert.ok(props.canvas instanceof Signal);
    assert.ok(props.muted instanceof Signal);
    assert.ok(props.volume instanceof Signal);
    this.props = props; resources.players.push(this);
  }
  close() { this.closed = true; this.broadcast.close(); }
}
class Publication {
  props: any;
  closed = false;
  constructor(props: any) { this.props = props; resources.publications.push(this); }
  close() { this.closed = true; }
}
class Device {
  in: any;
  out = { source: new Signal(undefined), error: new Signal(undefined) };
  closed = false;
  constructor(props: any) { assert.ok(props.enabled instanceof Signal); this.in = props; resources.devices.push(this); }
  close() { this.closed = true; }
}
class Capture {
  props: any;
  out = { display: new Signal(undefined) };
  closed = false;
  constructor(props: any) { this.props = props; resources.captures.push(this); }
  close() { this.closed = true; }
}
class Encoder {
  name: string; props: any; closed = false;
  constructor(name: string, props: any) { this.name = name; this.props = props; resources.encoders.push(this); }
  close() { this.closed = true; }
}
const tokenState = { publish: true };
let nativeConnects = 0;
const nativeSession = { state: "connected", connect() { nativeConnects++; }, disconnect() {} };
const nativePublisher = { state: "publishing", publish: (opts: any) => resources.nativePublications.push(opts), stop() {} };
const nativeCamera = { position: "front", state: "active", lastError: null as string | null };
const nativeMicrophone = { state: "active", lastError: null as string | null };
(globalThis as any).__lynkMocks = { Signal, Computed, Connection, Player, Publication, Device, Capture, Encoder, tokenState, nativeSession, nativePublisher, nativeCamera, nativeMicrophone, resources };
(globalThis as any).window = new EventTarget();
(globalThis as any).document = Object.assign(new EventTarget(), { visibilityState: "visible" });
const moduleUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const stubs: Record<string, string> = {
  "../observability": moduleUrl("export const enterRoomObservability = () => {}; export const exitRoomObservability = () => {};"),
  react: moduleUrl(["useState", "useRef", "useMemo", "useCallback", "useEffect", "useSyncExternalStore"].map((name) => `export const ${name} = (...args) => globalThis.__lynkHooks.${name}(...args);`).join("\n")),
  "@moq/signals": moduleUrl("export const Signal = globalThis.__lynkMocks.Signal; export const Computed = globalThis.__lynkMocks.Computed;"),
  "@moq/net": moduleUrl("export const Connection = globalThis.__lynkMocks.Connection; export const Path = { from: p => p }; export const Time = { Milli: { zero: 0 } };"),
  "@moq/watch": moduleUrl("export const Player = globalThis.__lynkMocks.Player;"),
  "@moq/publish": moduleUrl("export const Broadcast = globalThis.__lynkMocks.Publication; export const Source = { Camera: globalThis.__lynkMocks.Device, Microphone: globalThis.__lynkMocks.Device }; export const Video = { Capture: globalThis.__lynkMocks.Capture, Encoder: globalThis.__lynkMocks.Encoder }; export const Audio = Video;"),
  "react-native-moq": moduleUrl("export const useSession = () => globalThis.__lynkMocks.nativeSession; export const usePublisher = () => globalThis.__lynkMocks.nativePublisher; export const useCamera = (options) => {globalThis.__lynkMocks.resources.cameraOptions.push(options);return globalThis.__lynkMocks.nativeCamera}; export const useMicrophone = (options) => {globalThis.__lynkMocks.resources.microphoneOptions.push(options);return globalThis.__lynkMocks.nativeMicrophone}; export const useBroadcasts = () => [];"),
  "./useMoqToken": moduleUrl("export const useMoqToken = (room, intent, enabled = true) => ({ token: room && enabled && (intent !== 'publish' || globalThis.__lynkMocks.tokenState.publish) ? { relayUrl: 'https://example.invalid/' + room + '/' + intent, namespace: 'lynk/' + room, path: 'lynk/' + room + '/self', peerId: 'self' } : null, error: null });"),
};
const hooks = registerHooks({ resolve(specifier: string, context: { parentURL?: string }, next: (...args: any[]) => any) {
  if (stubs[specifier]) return { url: stubs[specifier], shortCircuit: true };
  if (specifier.startsWith(".") && (context.parentURL?.includes("/lib/lynk/") || context.parentURL?.includes("/features/sneaky-lynk/session/")) && !specifier.endsWith(".ts")) {
    return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { useLynkViewer } = await import("./useLynkViewer.web.ts");
const { useLynkBroadcast } = await import("./useLynkBroadcast.web.ts");
const { useLynkBroadcast: useNativeBroadcast } = await import("./useLynkBroadcast.native.ts");
const { useNativeMoqSession } = await import("./useNativeMoqSession.ts");
const { useRoomSession } = await import("../../features/sneaky-lynk/session/useRoomSession.ts");
const { deriveLynkState } = await import("./lynkState.ts");
after(() => { hooks.deregister(); delete (globalThis as any).window; });
function reset() {
  for (const value of Object.values(resources)) value.length = 0;
  tokenState.publish = true;
  nativeCamera.state = nativeMicrophone.state = "active";
  nativeCamera.lastError = nativeMicrophone.lastError = null;
}

test("web viewer reconstructs its connection during effect replay", () => {
  reset();
  const h = new Hooks();
  h.render(() => useLynkViewer("room"));
  const first = resources.connections.at(-1);
  h.replay();
  assert.equal(first.closed, true);
  assert.equal(resources.connections.length, 2);
  assert.equal(resources.connections.at(-1).closed, false);
  assert.equal(resources.connections.at(-1).props.share, false);
  assert.equal(resources.connections.at(-1).props.linger, 0);
  assert.equal(resources.connections.at(-1).props.url.peek().pathname, "/room/subscribe");
  h.unmount();
  assert.equal(resources.connections.at(-1).closed, true);
});

test("late joining viewer discovers already-published paths and closes both decoder and subscription", async () => {
  reset();
  resources.initialPaths.push("lynk/room/alice", "lynk/other/bob");
  const h = new Hooks();
  const view = h.render(() => useLynkViewer("room"));
  assert.deepEqual(view.publishers, [{ path: "lynk/room/alice", peerId: "alice", videoAvailable: false }]);
  view.attachCanvas("lynk/room/alice", {});
  assert.equal(resources.players.length, 1);
  assert.equal(resources.watches.length, 1);
  view.attachCanvas("lynk/room/alice", null);
  await Promise.resolve();
  assert.equal(resources.players[0].closed, true);
  assert.equal(resources.watches[0].closed, true);
  h.unmount();
});

test("room switch closes old discovery and establishes the new room", () => {
  reset();
  const h = new Hooks();
  h.render(() => useLynkViewer("first"));
  const old = resources.connections.at(-1);
  h.render(() => useLynkViewer("second"));
  assert.equal(old.closed, true);
  assert.equal(resources.connections.at(-1).props.url.peek().pathname, "/second/subscribe");
  h.unmount();
});

test("web publication uses AVC and role loss closes its prior publication", async () => {
  reset();
  const h = new Hooks();
  let permitted = true;
  const view = h.render(() => useLynkBroadcast("room", permitted));
  await view.goLive();
  h.flush();
  assert.equal(resources.publications.length, 1);
  assert.equal(resources.encoders.find((encoder) => encoder.name === "video/hd").props.config.codec, "avc1");
  assert.equal(resources.encoders.length, 2);
  assert.ok(resources.encoders.every((encoder) => encoder.props.bandwidth === resources.connections.at(-1).bandwidth));
  assert.equal(resources.captures.length, 2);
  assert.ok(resources.encoders.every((encoder) => encoder.props.broadcast === resources.publications[0]));
  permitted = false;
  h.render();
  assert.equal(resources.publications[0].closed, true);
  assert.ok(resources.encoders.every((encoder) => encoder.closed), "role loss closes all encoders");
  assert.ok(resources.captures.every((capture) => capture.closed), "role loss closes capture fanouts");
  h.unmount();
  assert.ok(resources.captures.every((capture) => capture.closed), "unmount closes capture fanouts");
  assert.ok(resources.devices.every((device) => device.closed));
  assert.ok(resources.computeds.every((computed) => computed.closed));
});

test("publish-token revocation closes encoders, capture fanouts and derived media signals", async () => {
  reset();
  const h = new Hooks();
  const view = h.render(() => useLynkBroadcast("room", true));
  await view.goLive(); h.flush();
  assert.equal(resources.publications.length, 1);
  tokenState.publish = false; h.render();
  assert.equal(resources.publications[0].closed, true);
  assert.ok(resources.encoders.every((encoder) => encoder.closed));
  assert.ok(resources.captures.every((capture) => capture.closed));
  h.unmount();
  assert.ok(resources.computeds.every((computed) => computed.closed));
});

test("web publication survives effect replay with fresh devices and closes the final pipeline on end", async () => {
  reset();
  const h = new Hooks();
  h.render(() => useLynkBroadcast("room", true));
  const firstDevices = [...resources.devices];
  h.replay();
  assert.ok(firstDevices.every((device) => device.closed));
  assert.ok(resources.devices.slice(firstDevices.length).every((device) => !device.closed));
  await h.value.goLive(); h.flush();
  assert.equal(resources.publications.length, 1);
  h.value.end(); h.flush();
  assert.ok(resources.publications.every((publication) => publication.closed));
  assert.ok(resources.encoders.every((encoder) => encoder.closed));
  assert.ok(resources.captures.every((capture) => capture.closed));
  assert.ok(resources.devices.every((device) => device.closed));
  assert.ok(resources.connections.every((connection) => connection.closed));
  h.unmount();
});

test("origin withdrawals close an attached player and its owned subscription", () => {
  reset(); resources.initialPaths.push("lynk/room/alice");
  const h = new Hooks();
  const view = h.render(() => useLynkViewer("room"));
  view.attachCanvas("lynk/room/alice", {});
  resources.connections[0].routes.set(new Map());
  h.render();
  assert.deepEqual(h.value.publishers, []);
  assert.equal(resources.players[0].closed, true);
  assert.equal(resources.watches[0].closed, true);
  h.unmount();
  assert.ok(resources.computeds.every((computed) => computed.closed));
});

test("native effect replay does not leave a newly admitted publisher permanently ended", async () => {
  reset();
  const h = new Hooks();
  h.render(() => useNativeBroadcast("room", true));
  h.replay();
  await h.value.goLive();
  h.flush();
  assert.ok(resources.nativePublications.length > 0);
  assert.notEqual(h.value.state, "ended");
  h.unmount();
});

test("native relay drops reconnect with backoff and leaving cancels the retry", () => {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextId = 0;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++nextId;
    timers.set(id, { callback, delay });
    return id;
  }) as any;
  globalThis.clearTimeout = ((id: number) => timers.delete(id)) as any;
  const h = new Hooks();
  try {
    nativeConnects = 0;
    nativeSession.state = "error:transport";
    let enabled = true;
    h.render(() => useNativeMoqSession("https://example.invalid/relay", enabled));
    assert.equal(nativeConnects, 1);
    assert.equal([...timers.values()][0].delay, 1000);
    [...timers.values()][0].callback();
    assert.equal(nativeConnects, 2);
    nativeSession.state = "connecting";
    h.render();
    nativeSession.state = "error:transport";
    h.render();
    assert.equal([...timers.values()][0].delay, 2000);
    enabled = false;
    h.render();
    assert.equal(timers.size, 0);
  } finally {
    h.unmount();
    nativeSession.state = "connected";
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});


test("terminal relay errors surface and recover when fresh credentials clear them", () => {
  reset();
  const h = new Hooks();
  h.render(() => useLynkViewer("room"));
  const connection = resources.connections[0];
  connection.status.set("disconnected");
  connection.error.set(new Error("Credentials rejected"));
  h.render();
  assert.equal(h.value.state, "error");
  assert.equal(h.value.error, "Credentials rejected");
  connection.error.set(undefined);
  connection.status.set("connected");
  h.render();
  assert.equal(h.value.error, null);
  assert.notEqual(h.value.state, "error");
  h.unmount();
});

test("web publisher keeps recoverable capture failures separate from fatal transport errors", async () => {
  reset();
  const h = new Hooks();
  const view = h.render(() => useLynkBroadcast("room", true));
  await view.goLive(); h.flush();
  const camera = resources.devices[0];
  const microphone = resources.devices[1];
  camera.out.error.set(new Error("Camera permission denied")); h.render();
  assert.equal(h.value.state, "live");
  assert.equal(h.value.error, null);
  assert.equal(h.value.captureError, "Camera permission denied");
  h.value.setCameraEnabled(false); h.flush();
  assert.equal(h.value.captureError, null, "disabled camera's old failure is not active");
  microphone.out.error.set(new Error("Microphone unavailable")); h.render();
  assert.equal(h.value.captureError, "Microphone unavailable");
  assert.equal(h.value.error, null);
  microphone.out.error.set(undefined); h.render();
  assert.equal(h.value.state, "live");
  const connection = resources.connections.at(-1);
  connection.status.set("disconnected");
  connection.error.set(new Error("Publisher authorization rejected")); h.render();
  assert.equal(h.value.state, "error");
  assert.equal(h.value.error, "Publisher authorization rejected");
  h.unmount();
});


test("native microphone capture errors are visible without disconnecting receiving or repeatedly retrying", async () => {
  reset();
  const h = new Hooks();
  h.render(() => useNativeBroadcast("room", true));
  await h.value.goLive(); h.flush();
  nativeMicrophone.state = "error:permission denied";
  nativeMicrophone.lastError = "Microphone permission denied";
  h.render();
  assert.equal(h.value.microphoneError, "Microphone permission denied");
  assert.equal(h.value.captureError, "Microphone permission denied");
  assert.equal(h.value.cameraError, null);
  const publications = resources.nativePublications.length;
  assert.equal(h.value.state, "live", "local capture cannot restart room admission/reception");
  assert.equal(h.value.error, null, "transport error remains independent");
  for (let i = 0; i < 3; i++) { h.value.setMicEnabled(true); h.render(); }
  assert.ok(resources.microphoneOptions.every((o) => o.enabled), "ordinary reconciliation never retries permission");
  assert.equal(resources.nativePublications.length, publications);
  resources.cameraOptions.length = resources.microphoneOptions.length = 0;
  h.value.retryCapture(); h.value.retryCapture(); h.flush();
  assert.deepEqual(resources.microphoneOptions.map((o) => o.enabled), [false, true], "repeated clicks coalesce into one stopped render then restart");
  assert.ok(resources.cameraOptions.every((o) => o.enabled), "healthy camera never restarts");
  assert.equal(h.value.captureError, "Microphone permission denied", "retry does not hide a persistent capture failure");
  nativeMicrophone.state = "idle"; h.render();
  assert.equal(h.value.captureError, "Microphone permission denied", "stop/idle does not pretend recovery");
  nativeMicrophone.state = "starting"; h.render();
  assert.equal(h.value.captureError, null);
  nativeMicrophone.state = "active"; h.render();
  assert.equal(h.value.microphoneError, null, "old lastError is ignored after capture recovers");
  h.unmount();
});

test("native capture retry respects mute, role loss, disabled devices and terminal leave", () => {
  reset();
  const h = new Hooks();
  let canPublish = true;
  h.render(() => useNativeBroadcast("room", canPublish));
  nativeCamera.state = "error:Camera unavailable";
  nativeMicrophone.state = "error:Microphone unavailable";
  h.render();
  assert.equal(h.value.cameraError, "Camera unavailable");
  assert.equal(h.value.captureError, "Microphone unavailable");
  h.value.retryCapture();
  h.value.setMicEnabled(false); h.flush();
  assert.equal(resources.microphoneOptions.at(-1).enabled, false, "host mute during retry cannot reenable mic");
  assert.equal(h.value.microphoneError, null, "muted device's old error is not active");
  assert.equal(h.value.captureError, "Camera unavailable");
  h.value.retryCapture(); canPublish = false; h.render();
  assert.equal(resources.cameraOptions.at(-1).enabled, false);
  assert.equal(resources.microphoneOptions.at(-1).enabled, false);
  assert.equal(h.value.captureError, null, "listeners do not inherit capture failures");
  canPublish = true; h.render();
  h.value.retryCapture(); h.value.end(); h.flush();
  assert.equal(resources.cameraOptions.at(-1).enabled, false);
  assert.equal(resources.microphoneOptions.at(-1).enabled, false);
  assert.equal(h.value.captureError, null);
  assert.equal(h.value.state, "ended");
  h.unmount();
});


test("web explicit retry replaces only failed capture, coalesces clicks and respects room teardown", async () => {
  reset();
  const h = new Hooks();
  let permitted = true;
  h.render(() => useLynkBroadcast("room", permitted));
  await h.value.goLive(); h.flush();
  const camera = resources.devices[0];
  const microphone = resources.devices[1];
  const receiver = resources.connections[0];
  microphone.out.error.set(new Error("Microphone permission denied")); h.render();
  const devicesBeforeRetry = resources.devices.length;
  h.value.setMicEnabled(true); h.flush();
  assert.equal(resources.devices.length, devicesBeforeRetry, "normal reconciliation does not retry");
  h.value.retryCapture(); h.value.retryCapture(); h.flush();
  assert.equal(resources.devices.length, devicesBeforeRetry + 1);
  assert.equal(microphone.closed, true);
  assert.equal(camera.closed, false);
  assert.equal(receiver.closed, false);
  const replacement = resources.devices.at(-1);
  assert.equal(replacement.in.enabled.peek(), true);
  replacement.out.error.set(new Error("Microphone permission denied")); h.render();
  h.value.retryCapture(); h.value.setMicEnabled(false); h.flush();
  const mutedReplacement = resources.devices.at(-1);
  assert.equal(mutedReplacement.in.enabled.peek(), false, "same-turn host mute wins before capture enables");
  h.value.setMicEnabled(true); h.flush();
  mutedReplacement.out.error.set(new Error("Microphone permission denied")); h.render();
  const staleRetry = h.value.retryCapture;
  permitted = false; h.render();
  staleRetry(); h.flush();
  assert.equal(resources.devices.at(-1), mutedReplacement, "stale callback cannot bypass role loss");
  permitted = true; h.render();
  h.value.end(); staleRetry(); h.flush();
  assert.equal(resources.devices.at(-1), mutedReplacement, "end disables retry synchronously");
  assert.ok(resources.devices.every((device) => device.closed));
  h.unmount();
});


test("already-connected transport starts an active room session without an intermediate render", () => {
  const h = new Hooks();
  let status: any = "connected";
  h.render(() => useRoomSession(status));
  assert.equal(h.value.state, "connected", "fast admission cannot leave heartbeat inactive");
  status = "disconnected"; h.render();
  assert.equal(h.value.state, "reconnecting");
  status = "connecting"; h.render();
  assert.equal(h.value.state, "reconnecting", "transport retry remains recovery, not a new room");
  status = "connected"; h.render();
  assert.equal(h.value.state, "connected");
  h.unmount();
});

test("explicit leave remains ended despite a late token/transport error", () => {
  assert.equal(deriveLynkState({ hasToken: false, connection: "disconnected", hasMedia: false, ended: true, error: true }), "ended");
});
