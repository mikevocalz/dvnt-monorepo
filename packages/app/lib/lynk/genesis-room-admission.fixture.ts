import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";

// Explicitly run by lynk-room-regressions.yml with isolated DOM dependencies;
// kept outside the dependency-light test:node glob. No test is skipped.
// Real React screens, admission/API/token hooks and MoQ lifecycle. Only device,
// relay, authentication and server I/O boundaries are mocked. No live accounts,
// rooms, cameras, credentials or messages are used.
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const app = path.join(ROOT, "packages/app");
const boundaries: Record<string, string> = {
  "react-native": `import React from 'react'; const f=window.fixture; export const Platform={OS:f.platform}; export const AppState=f.appState;
    export const View=({children,className,style})=>React.createElement('div',{className,style},children);export const Text=View;export const ScrollView=View;
    export const Pressable=({children,onPress,disabled})=>React.createElement('button',{onClick:onPress,disabled},children);`,
  "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({top:0,bottom:0});`,
  "expo-router": `export const useLocalSearchParams=()=>({roomId:window.fixture.room,isHost:window.fixture.broadcast?'1':'0'});export const useRouter=()=>({back:()=>window.fixture.exits++});`,
  "solito/navigation": `export const useParams=()=>({roomId:window.fixture.room});export const useSearchParams=()=>new URLSearchParams(window.fixture.broadcast?'isHost=1':'');export const useRouter=()=>({back:()=>window.fixture.exits++});`,
  "@dvnt/ui": `import React from 'react';export const VideoTile=({canvasRef,label})=>React.createElement('canvas',{ref:canvasRef,'aria-label':label||'Remote video'});`,
  "@dvnt/app/lib/stores/auth-store": `import {useSyncExternalStore} from 'react'; const f=window.fixture; export const useAuthStore=selector=>selector(useSyncExternalStore(f.subscribe,f.getState,f.getState)); useAuthStore.subscribe=f.subscribe; useAuthStore.getState=f.getState;`,
  "@dvnt/app/lib/auth/identity": `export const requireBetterAuthToken=async()=>window.fixture.owner;`,
  "@dvnt/app/lib/supabase/client": `export const supabase={functions:{invoke:(name,options)=>window.fixture.invoke(name,options)}};`,
  "@dvnt/app/lib/supabase/realtime": `export const freshChannel=()=>{throw new Error('Unexpected channel boundary');};`,
  "@dvnt/app/features/video/api": `import {videoApi as real} from ${JSON.stringify(path.join(app, "features/video/api.ts"))}; const f=window.fixture; export const videoApi={...real,subscribeToRoomEvents:f.events,subscribeToMembers:f.members};`,
  "@dvnt/app/features/sneaky-lynk/api/supabase": `const f=window.fixture;export const sneakyLynkApi={heartbeat:f.heartbeat,leaveRoom:f.leave};`,
  "@dvnt/app/lib/api/event-lynk": `export const eventLynkApi={wait:room=>window.fixture.wait(room)};`,
  "lifecycle-source-fixture": `export const createRoomLifecycleSource=options=>window.fixture.lifecycle(options.roomId);`,
  "@moq/signals": `export const Signal=window.fixture.Signal;`,
  "@moq/lite": `export const Connection={Reload:window.fixture.Reload};export const Path={from:path=>path};`,
  "@moq/watch": `export const Broadcast=window.fixture.Watch;export const MultiBackend=window.fixture.Backend;`,
  "@moq/publish": `export const Broadcast=window.fixture.Publication;export const Source={Camera:window.fixture.Device,Microphone:window.fixture.Device};`,
  "react-native-moq": `import React,{useMemo,useRef,useEffect,useState,useCallback,useSyncExternalStore} from 'react';const f=window.fixture;
    export function useSession(url){const session=useMemo(()=>{const signal=new f.Signal('idle');const next={id:Symbol(),signal,connect:()=>signal.set('connected'),disconnect:()=>signal.set('closed')};f.sessions.push(next);return next;},[url]);const state=useSyncExternalStore(cb=>session.signal.subscribe(cb),()=>session.signal.peek());return {...session,state};}
    export function usePublisher(session){const ref=useRef(null);const [state,setState]=useState('idle');const publish=useCallback(options=>{ref.current?.close();ref.current=new f.Publication({name:options.path});setState('publishing');},[session.id]);const stop=useCallback(()=>{ref.current?.close();ref.current=null;setState('idle');},[session.id]);return {state,publish,stop};}
    function useDevice(options){const ref=useRef(null);if(!ref.current)ref.current=new f.Device();useEffect(()=>{ref.current.enabled.set(options.enabled);return()=>ref.current.enabled.set(false);},[options.enabled]);useEffect(()=>()=>ref.current.close(),[]);return ref.current;}
    export const useCamera=useDevice;export const useMicrophone=useDevice;
    export function useBroadcasts(session,namespace){const paths=useSyncExternalStore(cb=>f.announcements.subscribe(cb),()=>f.announcements.peek());return useMemo(()=>session.state==='connected'?paths.split('\\n').filter(path=>path.startsWith(namespace+'/')).map(path=>({path,player:f.player(path)})):[],[paths,namespace,session.state]);}
    export const useVideoPlayer=broadcast=>broadcast.player;export const VideoView=()=>React.createElement('canvas');export const PublisherView=()=>React.createElement('div');`,
};
const bundles = await Promise.all(["web", "native"].map((platform) => esbuild.build({
  stdin: { resolveDir: ROOT, loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Screen from './packages/app/features/screens/(protected)/lynk/[roomId]/${platform}';
    import {videoApi} from '@dvnt/app/features/video/api';
    import {fetchMoqToken} from './packages/app/lib/lynk/useMoqToken';
    const f=window.fixture; const root=createRoot(document.getElementById('root'));
    f.render=()=>root.render(f.strict?<React.StrictMode><Screen/></React.StrictMode>:<Screen/>);
    f.unmount=()=>root.unmount(); f.api={videoApi,fetchMoqToken}; f.render();
  ` },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  nodePaths: (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
  tsconfigRaw: { compilerOptions: { jsx: "react-jsx", jsxImportSource: "react" } },
  define: { "process.env.NODE_ENV": '"test"' },
  plugins: [{ name: "genesis-boundaries", setup(build: any) {
    build.onResolve({ filter: /.*/ }, (args: any) => {
      if (Object.hasOwn(boundaries, args.path)) return { path: args.path, namespace: "fixture" };
      if (args.path === "../room-lifecycle-source" && args.importer.endsWith("useRoomLifecycle.ts")) return { path: "lifecycle-source-fixture", namespace: "fixture" };
      if (args.path.startsWith("@dvnt/app/")) return { path: path.join(app, args.path.slice("@dvnt/app/".length)) + ".ts" };
    });
    build.onLoad({ filter: /.*/, namespace: "fixture" }, (args: any) => ({ loader: "tsx", resolveDir: ROOT, contents: boundaries[args.path] }));
  } }],
})));

class Signal {
  value: any;
  listeners = new Set<() => void>();
  constructor(value: any) { this.value = value; }
  peek() { return this.value; }
  set(value: any) { this.value = value; for (const callback of this.listeners) callback(); }
  subscribe(callback: () => void) { this.listeners.add(callback); return () => this.listeners.delete(callback); }
}
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => { resolve = done; });
  return { promise, resolve };
};
async function until(predicate: () => unknown, label = "fixture settles") {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
const clients = new Set<any>();
after(() => { for (const client of clients) client.close(); });
function server() {
  return { publishers: new Set<string>(), reloads: new Set<any>(), lifecycle: new Set<any>(), ended: new Set<string>(), announcements: new Signal(""),
    announce() { for (const reload of this.reloads) reload.announced.set(new Set(this.publishers)); this.announcements.set([...this.publishers].sort().join("\n")); },
    end(room: string, broadcast = true) {
      this.ended.add(room);
      if (broadcast) for (const sub of [...this.lifecycle]) if (sub.room === room) sub.callbacks.onSnapshot({ status: "ended" });
    },
  };
}
function client(s: ReturnType<typeof server>, owner = "alice", broadcast = false, strict = false, platform = "web") {
  const changes = new Set<(...args: any[]) => void>();
  const appListeners = new Set<() => void>();
  let authState = { user: { id: owner, authId: owner } };
  const f: any = {
    room: "room-one", owner, broadcast, strict, platform, exits: 0, joins: [], mints: [], heartbeats: [], leaves: [], waits: [], ends: [],
    subscriptions: [], reloads: [], devices: [], publications: [], watches: [], backends: [], errors: [],
    sessions: [], players: new Map(), announcements: s.announcements,
    player(path: string) { if (!f.players.has(path)) f.players.set(path, { playing: false, setVolume() {}, play() { this.playing = true; }, stop() { this.playing = false; } }); return f.players.get(path); },
    getState: () => authState,
    subscribe: (callback: () => void) => { changes.add(callback); return () => changes.delete(callback); },
    setOwner(next: string) { f.owner = next; authState = { user: { id: next, authId: next } }; for (const callback of changes) callback(authState); },
    appState: { currentState: "active", addEventListener(_event: string, callback: () => void) { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } },
    background(state: string) { f.appState.currentState = state; for (const callback of appListeners) callback(); },
    invoke(name: string, options: any) {
      if (name === "video_heartbeat") { f.heartbeats.push(options.body.roomId); return Promise.resolve({ data: { ok: true }, error: null }); }
      if (name === "video_join_room") {
        const response = deferred(); f.joins.push({ ...response, options }); return response.promise;
      }
      if (name === "lynk-moq-token") {
        f.mints.push(options);
        const { roomId, intent } = options.body;
        if (intent === "publish" && f.rejectPublish) return Promise.resolve({ data: { ok: false, error: { code: "forbidden", message: "Publishing is no longer available" } }, error: null });
        return Promise.resolve({ data: { ok: true, data: { relayUrl: `https://relay.invalid/${roomId}/${f.owner}/${intent}`, namespace: `lynk/${roomId}`, path: `lynk/${roomId}/${f.owner}`, peerId: f.owner, role: "host", expiresAt: new Date(Date.now() + 120_000).toISOString() } }, error: null });
      }
      if (name === "video_end_room") { const response = deferred(); f.ends.push({ ...response, options }); return response.promise; }
      throw new Error(`Unexpected edge function ${name}`);
    },
    events(room: string, user: string, callback: any) { const sub = { kind: "events", room, user, callback, active: true }; f.subscriptions.push(sub); return () => { sub.active = false; }; },
    members(room: string, _change: any, options: any) { const sub = { kind: "members", room, options, active: true }; f.subscriptions.push(sub); return () => { sub.active = false; }; },
    heartbeat: async (room: string) => { f.heartbeats.push(room); return { ok: true }; },
    leave: async (room: string) => { f.leaves.push(room); return { ok: true }; },
    wait(room: string) { const response = deferred(); f.waits.push({ ...response, room }); return response.promise; },
    lifecycle(room: string) {
      return {
        load: async () => ({ status: s.ended.has(room) ? "ended" : "open" }),
        subscribe(callbacks: any) { const sub = { room, callbacks, client: f }; s.lifecycle.add(sub); return () => s.lifecycle.delete(sub); },
      };
    },
    Signal,
  };
  f.Reload = class {
    announced = new Signal(new Set(s.publishers));
    status = new Signal("connected");
    established = new Signal({});
    closed = false;
    constructor() { f.reloads.push(this); s.reloads.add(this); }
    close() { this.closed = true; s.reloads.delete(this); }
  };
  f.Device = class {
    enabled = new Signal(false); source = new Signal(undefined); closed = false;
    constructor() { f.devices.push(this); }
    close() { this.closed = true; this.enabled.set(false); }
  };
  f.Publication = class {
    name: string; closed = false;
    constructor(options: any) { this.name = options.name; f.publications.push(this); s.publishers.add(this.name); s.announce(); }
    close() { this.closed = true; s.publishers.delete(this.name); s.announce(); }
  };
  f.Watch = class { closed = false; constructor() { f.watches.push(this); } close() { this.closed = true; } };
  f.Backend = class {
    element = new Signal(null); audio = { muted: new Signal(false), volume: new Signal(1) }; closed = false;
    constructor(options: any) { this.element.set(options.element); f.backends.push(this); }
    close() { this.closed = true; }
  };
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://app.invalid", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.fixture = f;
  dom.window.addEventListener("error", (event: any) => f.errors.push(event.message));
  dom.window.eval(bundles[platform === "web" ? 0 : 1].outputFiles[0].text);
  f.dom = dom;
  f.text = () => dom.window.document.body.textContent;
  f.click = (label: string) => {
    const button = [...dom.window.document.querySelectorAll("button")].find((item: any) => item.textContent === label) as any;
    assert.ok(button, `button ${label} exists: ${f.text()}`);
    button.click();
  };
  f.admit = (index = f.joins.length - 1, role = owner === "alice" ? "host" : "participant") => {
    const join = f.joins[index];
    join.resolve({ error: null, data: { ok: true, data: { room: { id: join.options.body.roomId, title: "Fixture" }, user: { id: join.options.headers.Authorization.slice(7) }, peer: { id: "peer", role }, expiresAt: new Date(Date.now() + 120_000).toISOString() } } });
  };
  f.deny = (detail: string, message = "Denied", code = "forbidden", index = f.joins.length - 1) => {
    const payload = { ok: false, error: { code, message, detail: { reason: detail } } };
    // Supabase HTTP failure route must retain structured admission detail.
    f.joins[index].resolve({ data: null, error: { message: "HTTP failure", context: new Response(JSON.stringify(payload), { status: 403 }) } });
  };
  f.close = () => { f.unmount(); dom.window.close(); clients.delete(f); };
  clients.add(f);
  return f;
}

test("denied, full, app-only and waiting joins never mount media; waiting admission still runs normal join", async () => {
  for (const reason of ["invite_only", "room_full", "ROOM_APP_ONLY", "verification_required"]) {
    const f = client(server(), "alice", true);
    await until(() => f.joins.length === 1);
    assert.equal(f.joins[0].options.body.platform, "web");
    assert.equal(f.mints.length, 0);
    f.deny(reason, reason === "room_full" ? "Room is full" : "Denied", reason === "room_full" ? "conflict" : "forbidden");
    await until(() => f.text().includes("Try again"));
    assert.equal(f.mints.length, 0); assert.equal(f.devices.length, 0); assert.equal(f.heartbeats.length, 0);
    if (reason === "ROOM_APP_ONLY") assert.match(f.text(), /app-only/);
    f.close();
  }
  const f = client(server(), "bob");
  await until(() => f.joins.length === 1);
  f.deny("waiting_for_host");
  await until(() => f.waits.length === 1);
  assert.match(f.text(), /Waiting for the host/); assert.equal(f.mints.length, 0);
  f.waits[0].resolve({ admitted: true });
  await until(() => f.joins.length === 2);
  assert.equal(f.mints.length, 0, "waiting permission is not media admission");
  f.admit(); await until(() => f.mints.length === 1);
  assert.equal(f.mints[0].body.intent, "subscribe"); assert.equal(f.mints[0].body.platform, "web");
  f.close();
});

test("two real clients discover already-published peers; viewer mode never captures and Go Live requires opt-in", async () => {
  const s = server(); const host = client(s, "alice", true);
  await until(() => host.joins.length === 1); host.admit();
  await until(() => host.text().includes("Go Live"));
  assert.equal(host.devices.filter((device: any) => device.enabled.peek()).length, 0);
  assert.equal(host.mints.filter((request: any) => request.body.intent === "publish").length, 0);
  host.click("Go Live"); await until(() => s.publishers.has("lynk/room-one/alice"));
  const viewer = client(s, "bob");
  await until(() => viewer.joins.length === 1); viewer.admit();
  await until(() => viewer.backends.some((backend: any) => !backend.closed));
  assert.equal(viewer.dom.window.document.querySelectorAll("canvas").length, 1);
  assert.equal(viewer.devices.length, 0); assert.equal(viewer.mints.length, 1);
  assert.equal(viewer.mints[0].body.intent, "subscribe");
  assert.equal(host.heartbeats.length, 1); assert.equal(viewer.heartbeats.length, 1);
  s.end("room-one");
  await until(() => host.text().includes("This Lynk has ended") && viewer.text().includes("This Lynk has ended"));
  await until(() => s.publishers.size === 0 && s.reloads.size === 0 && s.lifecycle.size === 0, "both clients release media and lifecycle observers");
  assert.equal(s.publishers.size, 0); assert.equal(s.reloads.size, 0); assert.equal(s.lifecycle.size, 0);
  assert.ok(host.devices.every((device: any) => !device.enabled.peek()));
  assert.ok(viewer.backends.every((backend: any) => backend.closed));
  assert.ok(viewer.watches.every((watch: any) => watch.closed));
  assert.ok([...host.subscriptions, ...viewer.subscriptions].every((sub: any) => !sub.active));
  assert.deepEqual(host.errors, []); assert.deepEqual(viewer.errors, []);
  host.close(); viewer.close();
});

test("query mode cannot grant publish authority; roster role loss tears down capture", async () => {
  const s = server(); const f = client(s, "bob", true);
  await until(() => f.joins.length === 1); f.admit(0, "moderator");
  await until(() => f.mints.length === 1);
  assert.doesNotMatch(f.text(), /Go Live/); assert.equal(f.devices.length, 0);
  const roster = f.subscriptions.find((sub: any) => sub.kind === "members");
  roster.options.onSync([{ userId: "bob", role: "co-host" }]);
  await until(() => f.text().includes("Go Live"));
  f.click("Go Live"); await until(() => s.publishers.size === 1);
  roster.options.onSync([{ userId: "bob", role: "moderator" }]);
  await until(() => s.publishers.size === 0 && !f.text().includes("Go Live"));
  assert.ok(f.devices.every((device: any) => !device.enabled.peek()));
  f.close();
});

test("a rejected publish token stops opted-in devices and permits a deliberate retry", async () => {
  for (const platform of ["web", "ios"]) {
    const f = client(server(), "alice", true, false, platform);
    await until(() => f.joins.length === 1); f.admit(); await until(() => f.text().includes("Go Live"));
    f.rejectPublish = true; f.click("Go Live");
    await until(() => f.text().includes("Publishing is no longer available"));
    await until(() => f.devices.every((device: any) => !device.enabled.peek()), "token rejection stops capture");
    assert.match(f.text(), /Go Live/);
    f.rejectPublish = false; f.click("Go Live");
    await until(() => f.publications.some((publication: any) => !publication.closed));
    f.close();
  }
});

test("account and room switches reject late joins and remove old transport before readmission", async () => {
  const s = server(); const f = client(s, "alice", true);
  await until(() => f.joins.length === 1);
  f.setOwner("bob"); await until(() => f.joins.length === 2);
  f.admit(0); f.deny("invite_only", "Denied", "forbidden", 1);
  await until(() => f.text().includes("Try again"));
  assert.equal(f.mints.length, 0); assert.equal(f.devices.length, 0);
  f.click("Try again"); await until(() => f.joins.length === 3); f.admit(2, "co-host");
  await until(() => f.text().includes("Go Live")); f.click("Go Live"); await until(() => s.publishers.size === 1);
  f.room = "room-two"; f.render(); await until(() => f.joins.length === 4 && s.publishers.size === 0);
  const oldSubscriptions = f.subscriptions.slice();
  assert.ok(oldSubscriptions.every((sub: any) => !sub.active));
  f.admit(3, "co-host"); await until(() => f.text().includes("Go Live"));
  assert.equal(s.publishers.size, 0, "new room never inherits camera opt-in");
  f.close(); assert.equal(s.reloads.size, 0); assert.equal(s.lifecycle.size, 0);
});

test("batched A to B to A account changes invalidate the first A reply", async () => {
  const f = client(server(), "alice", true);
  await until(() => f.joins.length === 1);
  f.setOwner("bob"); f.setOwner("alice");
  await until(() => f.joins.length === 2);
  f.admit(0); f.deny("invite_only", "Denied", "forbidden", 1);
  await until(() => f.text().includes("Try again"));
  assert.equal(f.mints.length, 0); assert.equal(f.devices.length, 0);
  f.close();
});

test("leaving before admission ignores late replies, and guest leave never ends the room", async () => {
  const f = client(server(), "bob");
  await until(() => f.joins.length === 1);
  f.click("Leave"); await until(() => f.exits === 1);
  f.admit(); await until(() => f.text().includes("This Lynk has ended"));
  assert.equal(f.mints.length, 0); f.close();
  const g = client(server(), "bob");
  await until(() => g.joins.length === 1); g.admit(); await until(() => g.mints.length === 1);
  g.click("Leave"); await until(() => g.exits === 1 && g.leaves.length === 1);
  assert.equal(g.ends.length, 0); g.close();
});

test("rapid same-room unmount/remount never sends a stale automatic membership leave", async () => {
  const s = server(); const old = client(s, "alice", true);
  await until(() => old.joins.length === 1); old.admit(); await until(() => old.text().includes("Go Live"));
  old.click("Go Live"); await until(() => s.publishers.size === 1);
  old.close();
  const replacement = client(s, "alice", true);
  await until(() => replacement.joins.length === 1); replacement.admit();
  await until(() => replacement.text().includes("Go Live"));
  assert.equal(old.leaves.length, 0); assert.equal(old.ends.length, 0);
  assert.equal(replacement.leaves.length, 0); assert.equal(s.publishers.size, 0);
  replacement.click("Go Live"); await until(() => s.publishers.size === 1);
  replacement.close(); assert.equal(s.publishers.size, 0);
});

test("resume before an account-switch render cannot submit admission under the replacement identity", async () => {
  const f = client(server(), "alice");
  await until(() => f.joins.length === 1); f.admit(); await until(() => f.mints.length === 1);
  f.background("background"); await until(() => f.text().includes("Lynk paused"));
  f.setOwner("bob"); f.background("active");
  await until(() => f.joins.length >= 2);
  assert.equal(f.joins.length, 2, "only the replacement mount can join as Bob");
  f.deny("invite_only"); await until(() => f.text().includes("Try again"));
  assert.equal(f.joins.length, 2); f.close();
});

test("batched background and fast readmission still require a fresh camera opt-in", async () => {
  for (const platform of ["web", "ios"]) {
    const s = server(); const f = client(s, "alice", true, false, platform);
    await until(() => f.joins.length === 1); f.admit(); await until(() => f.text().includes("Go Live"));
    f.click("Go Live"); await until(() => s.publishers.size === 1);
    const invoke = f.invoke;
    f.invoke = (name: string, options: any) => {
      const result = invoke(name, options);
      if (name === "video_join_room") f.admit();
      return result;
    };
    f.background("background"); f.background("active");
    await until(() => f.joins.length === 2 && f.text().includes("Go Live"), "resumed admission resets capture opt-in");
    await until(() => s.publishers.size === 0 && f.devices.every((device: any) => !device.enabled.peek()));
    f.close();
  }
});

test("terminal room end stays terminal through immediate roster and background/resume callbacks", async () => {
  for (const platform of ["web", "ios"]) {
    const s = server(); const f = client(s, "alice", true, false, platform);
    await until(() => f.joins.length === 1); f.admit(); await until(() => f.text().includes("Go Live"));
    await until(() => f.subscriptions.some((sub: any) => sub.kind === "members") && s.lifecycle.size === 1);
    const invoke = f.invoke;
    f.invoke = (name: string, options: any) => {
      const result = invoke(name, options);
      if (name === "video_join_room") f.admit();
      return result;
    };
    const roster = f.subscriptions.find((sub: any) => sub.kind === "members");
    s.end("room-one");
    roster.options.onSync([{ userId: "alice", role: "host" }]);
    f.background("background"); f.background("active");
    await until(() => f.text().includes("This Lynk has ended") && s.lifecycle.size === 0);
    assert.equal(f.joins.length, 1, "a terminal lifetime cannot submit another admission");
    assert.equal(s.publishers.size, 0); f.close();
  }
});

test("late end completion cannot navigate a replacement room; failed end stays retryable", async () => {
  const s = server(); const f = client(s, "alice", true);
  await until(() => f.joins.length === 1); f.admit(); await until(() => f.text().includes("Go Live"));
  f.click("End Lynk"); await until(() => f.ends.length === 1);
  f.ends[0].resolve({ error: null, data: { ok: false, error: { message: "Retry ending" } } });
  await until(() => f.text().includes("Retry ending") && f.text().includes("End Lynk"));
  assert.equal(f.exits, 0);
  f.click("End Lynk"); await until(() => f.ends.length === 2);
  f.room = "room-two"; f.render(); await until(() => f.joins.length === 2);
  f.ends[1].resolve({ error: null, data: { ok: true } });
  f.admit(); await until(() => f.text().includes("Go Live"));
  assert.equal(f.exits, 0); f.close();
});

test("background stops media and resume readmission catches a missed host end; reconnect catches it too", async () => {
  const s = server(); const f = client(s, "alice", true);
  await until(() => f.joins.length === 1); f.admit(); await until(() => f.text().includes("Go Live"));
  f.click("Go Live"); await until(() => s.publishers.size === 1);
  f.background("background"); await until(() => s.publishers.size === 0);
  assert.ok(f.devices.every((device: any) => !device.enabled.peek()));
  s.end("room-one", false); f.background("active");
  await until(() => f.joins.length === 2 || f.text().includes("This Lynk has ended"));
  if (f.joins.length === 2) f.deny("ended", "This room has ended", "not_found");
  await until(() => f.text().includes("ended")); assert.equal(s.publishers.size, 0); f.close();
  const next = server(); const viewer = client(next, "bob");
  await until(() => viewer.joins.length === 1); viewer.admit(); await until(() => next.lifecycle.size === 1);
  next.end("room-one", false);
  for (const sub of next.lifecycle) sub.callbacks.onReconnect();
  await until(() => viewer.text().includes("This Lynk has ended"));
  await until(() => next.reloads.size === 0 && next.lifecycle.size === 0, "reconnect cleanup");
  assert.equal(next.reloads.size, 0); assert.equal(next.lifecycle.size, 0); viewer.close();
});

test("StrictMode replay ignores its abandoned join and unmount disposes the final admitted lifetime", async () => {
  const s = server(); const f = client(s, "alice", true, true);
  await until(() => f.joins.length === 2);
  f.admit(0); f.admit(1); await until(() => f.text().includes("Go Live"));
  assert.equal(f.devices.filter((device: any) => device.enabled.peek()).length, 0);
  f.close(); assert.equal(s.reloads.size, 0); assert.equal(s.lifecycle.size, 0);
  assert.ok(f.subscriptions.every((sub: any) => !sub.active));
});

test("native screen reuses admission, opt-in and server end while a second native viewer discovers a live host", async () => {
  const s = server(); const host = client(s, "alice", true, false, "ios");
  await until(() => host.joins.length === 1);
  assert.equal(host.joins[0].options.body.platform, "ios");
  host.deny("room_full", "Room is full", "conflict");
  await until(() => host.text().includes("Try again"));
  assert.equal(host.devices.length, 0); assert.equal(host.mints.length, 0);
  host.click("Try again"); await until(() => host.joins.length === 2); host.admit();
  await until(() => host.text().includes("Go Live"));
  assert.ok(host.devices.every((device: any) => !device.enabled.peek()));
  host.click("Go Live"); await until(() => s.publishers.size === 1);
  assert.ok(host.mints.every((request: any) => request.body.platform === "ios"));
  const viewer = client(s, "bob", false, false, "ios");
  await until(() => viewer.joins.length === 1); viewer.admit();
  await until(() => viewer.dom.window.document.querySelectorAll("canvas").length === 1);
  assert.equal(viewer.devices.length, 0); assert.ok(viewer.players.get("lynk/room-one/alice").playing);
  host.click("End"); await until(() => host.ends.length === 1);
  s.end("room-one"); host.ends[0].resolve({ data: { ok: true }, error: null });
  await until(() => s.publishers.size === 0 && viewer.text().includes("This Lynk has ended"));
  await until(() => !viewer.players.get("lynk/room-one/alice").playing);
  assert.ok(host.devices.every((device: any) => !device.enabled.peek()));
  assert.deepEqual(host.errors, []); assert.deepEqual(viewer.errors, []);
  host.close(); viewer.close(); assert.equal(s.lifecycle.size, 0);
});
