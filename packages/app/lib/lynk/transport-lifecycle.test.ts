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
  constructor(value: any) { this.value = value; }
  set(value: any) { this.value = value; }
  peek() { return this.value; }
  subscribe() { return () => {}; }
}
const resources = { reloads: [] as any[], backends: [] as any[], watches: [] as any[], publications: [] as any[], nativePublications: [] as any[], initialPaths: [] as string[] };
class Reload {
  props: any;
  closed = false;
  status = new Signal("connected");
  announced = new Signal(new Set(resources.initialPaths));
  established = new Signal({});
  constructor(props: any) { this.props = props; resources.reloads.push(this); }
  close() { this.closed = true; }
}
class WatchBroadcast {
  props: any;
  closed = false;
  constructor(props: any) { this.props = props; resources.watches.push(this); }
  close() { this.closed = true; }
}
class MultiBackend {
  element: Signal;
  closed = false;
  audio = { muted: new Signal(false), volume: new Signal(1) };
  constructor(props: any) { this.element = new Signal(props.element); resources.backends.push(this); }
  close() { this.closed = true; }
}
class Publication {
  props: any;
  closed = false;
  constructor(props: any) { this.props = props; resources.publications.push(this); }
  close() { this.closed = true; }
}
class Device {
  enabled = new Signal(false);
  source = new Signal(undefined);
  close() { this.enabled.set(false); }
}
let nativeConnects = 0;
const nativeSession = { state: "connected", connect() { nativeConnects++; }, disconnect() {} };
const nativePublisher = { state: "publishing", publish: (opts: any) => resources.nativePublications.push(opts), stop() {} };
const nativeCamera = { position: "front", state: "active" };
const nativeMicrophone = { state: "active" };
(globalThis as any).__lynkMocks = { Signal, Reload, WatchBroadcast, MultiBackend, Publication, Device, nativeSession, nativePublisher, nativeCamera, nativeMicrophone };
(globalThis as any).window = {};
const moduleUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const stubs: Record<string, string> = {
  react: moduleUrl(["useState", "useRef", "useMemo", "useCallback", "useEffect", "useSyncExternalStore"].map((name) => `export const ${name} = (...args) => globalThis.__lynkHooks.${name}(...args);`).join("\n")),
  "@moq/signals": moduleUrl("export const Signal = globalThis.__lynkMocks.Signal;"),
  "@moq/lite": moduleUrl("export const Connection = { Reload: globalThis.__lynkMocks.Reload }; export const Path = { from: p => p };"),
  "@moq/watch": moduleUrl("export const Broadcast = globalThis.__lynkMocks.WatchBroadcast; export const MultiBackend = globalThis.__lynkMocks.MultiBackend;"),
  "@moq/publish": moduleUrl("export const Broadcast = globalThis.__lynkMocks.Publication; export const Source = { Camera: globalThis.__lynkMocks.Device, Microphone: globalThis.__lynkMocks.Device };"),
  "react-native-moq": moduleUrl("export const useSession = () => globalThis.__lynkMocks.nativeSession; export const usePublisher = () => globalThis.__lynkMocks.nativePublisher; export const useCamera = () => globalThis.__lynkMocks.nativeCamera; export const useMicrophone = () => globalThis.__lynkMocks.nativeMicrophone; export const useBroadcasts = () => [];"),
  "./useMoqToken": moduleUrl("export const useMoqToken = (room, intent, enabled = true) => ({ token: room && enabled ? { relayUrl: 'https://example.invalid/' + room + '/' + intent, namespace: 'lynk/' + room, path: 'lynk/' + room + '/self', peerId: 'self' } : null, error: null });"),
};
const hooks = registerHooks({ resolve(specifier: string, context: { parentURL?: string }, next: (...args: any[]) => any) {
  if (stubs[specifier]) return { url: stubs[specifier], shortCircuit: true };
  if (specifier.startsWith(".") && context.parentURL?.includes("/lib/lynk/") && !specifier.endsWith(".ts")) {
    return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { useLynkViewer } = await import("./useLynkViewer.web.ts");
const { useLynkBroadcast } = await import("./useLynkBroadcast.web.ts");
const { useLynkBroadcast: useNativeBroadcast } = await import("./useLynkBroadcast.native.ts");
const { useNativeMoqSession } = await import("./useNativeMoqSession.ts");
after(() => { hooks.deregister(); delete (globalThis as any).window; });
function reset() { for (const value of Object.values(resources)) value.length = 0; }

test("web viewer reconstructs its connection during effect replay", () => {
  reset();
  const h = new Hooks();
  h.render(() => useLynkViewer("room"));
  const first = resources.reloads.at(-1);
  h.replay();
  assert.equal(first.closed, true);
  assert.equal(resources.reloads.length, 2);
  assert.equal(resources.reloads.at(-1).closed, false);
  assert.equal(resources.reloads.at(-1).props.url.peek().pathname, "/room/subscribe");
  h.unmount();
  assert.equal(resources.reloads.at(-1).closed, true);
});

test("late joining viewer discovers already-published paths and closes both decoder and subscription", () => {
  reset();
  resources.initialPaths.push("lynk/room/alice", "lynk/other/bob");
  const h = new Hooks();
  const view = h.render(() => useLynkViewer("room"));
  assert.deepEqual(view.publishers, [{ path: "lynk/room/alice", peerId: "alice" }]);
  view.attachCanvas("lynk/room/alice", {});
  assert.equal(resources.backends.length, 1);
  assert.equal(resources.watches.length, 1);
  view.attachCanvas("lynk/room/alice", null);
  assert.equal(resources.backends[0].closed, true);
  assert.equal(resources.watches[0].closed, true);
  h.unmount();
});

test("room switch closes old discovery and establishes the new room", () => {
  reset();
  const h = new Hooks();
  h.render(() => useLynkViewer("first"));
  const old = resources.reloads.at(-1);
  h.render(() => useLynkViewer("second"));
  assert.equal(old.closed, true);
  assert.equal(resources.reloads.at(-1).props.url.peek().pathname, "/second/subscribe");
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
  assert.equal(resources.publications[0].props.video.hd.config.codec, "avc1");
  permitted = false;
  h.render();
  assert.equal(resources.publications[0].closed, true);
  h.unmount();
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
