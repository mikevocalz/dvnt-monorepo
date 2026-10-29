/** Integration of the production hooks with the released asynchronous signals SDK.
 * Browser media, network, tokens and React are isolated; no real device or relay is used.
 * Run: node --test scripts/test-lynk-moq-signals.ts
 * Optional dependency root: LYNK_PROBE_DEPS=/path/to/isolated/packages
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dependencyRequire = createRequire(process.env.LYNK_PROBE_DEPS
  ? resolve(process.env.LYNK_PROBE_DEPS, "package.json")
  : new URL("../packages/app/package.json", import.meta.url));
const signalsPath = dependencyRequire.resolve("@moq/signals");
assert.equal(JSON.parse(readFileSync(resolve(dirname(signalsPath), "package.json"), "utf8")).version, "0.2.5");
const { Signal, Computed: SdkComputed, readonlys } = await import(pathToFileURL(signalsPath).href);
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
  useSyncExternalStore(subscribe: any, snapshot: () => any) {
    this.useEffect(() => subscribe(() => { this.dirty = true; }), [subscribe]);
    return snapshot();
  }
  async settle() {
    for (let pass = 0; pass < 20; pass++) {
      await tick();
      if (!this.dirty) return this.value;
      this.flush();
    }
    assert.fail("asynchronous signal rerender loop");
  }
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
  unmount() {
    for (const slot of this.slots) {
      slot.cleanup?.();
      slot.cleanup = undefined;
    }
  }
}
const changed = (a: any[] = [], b: any[] = []) => a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
class Computed extends SdkComputed {
  closed = false;
  constructor(fn: any) { super(fn); resources.computeds.push(this); }
  close() { this.closed = true; super.close(); }
}
const resources = {
  connections: [] as any[], players: [] as any[], watches: [] as any[], devices: [] as any[],
  captures: [] as any[], encoders: [] as any[], computeds: [] as any[], publications: [] as any[],
  initialPaths: [] as string[],
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
  media = new Signal(undefined);
  failure = new Signal(undefined);
  out = readonlys({ source: this.media, error: this.failure });
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
const savedGlobals = { window: (globalThis as any).window, document: (globalThis as any).document, MediaStream: (globalThis as any).MediaStream };
(globalThis as any).__lynkMocks = { Signal, Computed, Connection, Player, Publication, Device, Capture, Encoder, tokenState };
(globalThis as any).window = new EventTarget();
(globalThis as any).document = Object.assign(new EventTarget(), { visibilityState: "visible" });
(globalThis as any).MediaStream = class { tracks: any[]; constructor(tracks: any[]) { this.tracks = tracks; } };
const moduleUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const stubs: Record<string, string> = {
  react: moduleUrl(["useState", "useRef", "useMemo", "useCallback", "useEffect", "useSyncExternalStore"].map((name) => `export const ${name} = (...args) => globalThis.__lynkHooks.${name}(...args);`).join("\n")),
  "@moq/signals": moduleUrl("export const Signal = globalThis.__lynkMocks.Signal; export const Computed = globalThis.__lynkMocks.Computed;"),
  "@moq/net": moduleUrl("export const Connection = globalThis.__lynkMocks.Connection; export const Path = { from: p => p }; export const Time = { Milli: { zero: 0 } };"),
  "@moq/watch": moduleUrl("export const Player = globalThis.__lynkMocks.Player;"),
  "@moq/publish": moduleUrl("export const Broadcast = globalThis.__lynkMocks.Publication; export const Source = { Camera: globalThis.__lynkMocks.Device, Microphone: globalThis.__lynkMocks.Device }; export const Video = { Capture: globalThis.__lynkMocks.Capture, Encoder: globalThis.__lynkMocks.Encoder }; export const Audio = Video;"),
  "./useMoqToken": moduleUrl("export const useMoqToken = (room, intent, enabled = true) => ({ token: room && enabled && (intent !== 'publish' || globalThis.__lynkMocks.tokenState.publish) ? { relayUrl: 'https://example.invalid/' + room + '/' + intent, namespace: 'lynk/' + room, path: 'lynk/' + room + '/self', peerId: 'self' } : null, error: null });"),
};
const hooks = registerHooks({ resolve(specifier: string, context: { parentURL?: string }, next: (...args: any[]) => any) {
  if (stubs[specifier]) return { url: stubs[specifier], shortCircuit: true };
  if (specifier.startsWith(".") && context.parentURL?.includes("/lib/lynk/") && !specifier.endsWith(".ts")) {
    return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { useLynkViewer } = await import("../packages/app/lib/lynk/useLynkViewer.web.ts");
const { useLynkBroadcast } = await import("../packages/app/lib/lynk/useLynkBroadcast.web.ts");
after(() => {
  hooks.deregister();
  for (const [name, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete (globalThis as any)[name];
    else (globalThis as any)[name] = value;
  }
  delete (globalThis as any).__lynkHooks;
  delete (globalThis as any).__lynkMocks;
});
function reset() { for (const value of Object.values(resources)) value.length = 0; tokenState.publish = true; }

const tick = () => new Promise(resolve => setImmediate(resolve));
test("real signals: asynchronous initial discovery, replacement, withdrawal, and end", async (t) => {
  reset(); resources.initialPaths.push("lynk/room/alice");
  const h = new Hooks();
  t.after(() => h.unmount());
  h.render(() => useLynkViewer("room"));
  assert.deepEqual(h.value.publishers, []);
  await h.settle();
  assert.deepEqual(h.value.publishers.map((p: any) => p.path), ["lynk/room/alice"]);
  const attach = h.value.attachCanvas; attach("lynk/room/alice", {});
  h.value.setMuted(true); await h.settle();
  assert.equal(h.value.attachCanvas, attach);
  assert.equal(resources.players[0].props.muted.peek(), true);
  assert.equal(resources.players[0].props.delay, 0);
  const next = new Signal(new Map([["lynk/room/bob", {}]]));
  resources.connections[0].origin.set({ broadcasts: () => next });
  await h.settle();
  assert.deepEqual(h.value.publishers.map((p: any) => p.path), ["lynk/room/bob"]);
  assert.equal(resources.players[0].closed, true);
  h.value.attachCanvas("lynk/room/bob", {});
  resources.connections[0].origin.set(undefined);
  await h.settle();
  assert.deepEqual(h.value.publishers, []);
  assert.ok(resources.players.every((p: any) => p.closed));
  h.unmount(); await tick();
  assert.ok(resources.computeds.every((c: any) => c.closed));
});
test("real signals: publication ownership survives replay and token loss", async (t) => {
  reset(); const h = new Hooks();
  t.after(() => h.unmount());
  h.render(() => useLynkBroadcast("room", true));
  await h.settle(); h.replay(); await h.settle();
  const videoTrack = Object.assign(new EventTarget(), { kind: "video", readyState: "live", muted: false });
  const audioTrack = Object.assign(new EventTarget(), { kind: "audio", readyState: "live", muted: false });
  resources.devices.at(-2).media.set({ video: videoTrack });
  resources.devices.at(-1).media.set({ audio: audioTrack });
  await h.settle();
  assert.deepEqual(h.value.localStream.tracks, [videoTrack]);
  assert.deepEqual(h.value.localAudioStream.tracks, [audioTrack]);
  await h.value.goLive(); await h.settle();
  assert.equal(resources.publications.length, 1);
  assert.equal(resources.encoders.length, 2);
  assert.ok(resources.encoders.every((encoder: any) => encoder.props.bandwidth === resources.connections.at(-1).bandwidth));
  assert.equal(resources.encoders[0].props.config.codec, "avc1");
  tokenState.publish = false; h.render(); await h.settle();
  assert.ok(resources.publications.every((r: any) => r.closed));
  assert.ok(resources.captures.every((r: any) => r.closed));
  assert.ok(resources.encoders.every((r: any) => r.closed));
  h.value.end(); h.flush(); await tick(); h.unmount(); await tick();
  assert.ok(resources.computeds.every((r: any) => r.closed));
  assert.ok(resources.connections.every((r: any) => r.closed));
  assert.ok(resources.devices.every((r: any) => r.closed));
});
