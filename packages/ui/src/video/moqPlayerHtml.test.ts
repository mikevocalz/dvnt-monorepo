import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMoqPlayerHtml } from "./moqPlayerHtml.ts";

class Signal {
  value: any;
  listeners = new Set<(value: any) => void>();
  constructor(value: any) { this.value = value; }
  peek() { return this.value; }
  set(value: any) { this.value = value; for (const listener of [...this.listeners]) listener(value); }
  subscribe(listener: (value: any) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
class Events {
  listeners = new Map<string, Set<(event: any) => void>>();
  addEventListener(type: string, callback: (event: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(callback);
  }
  removeEventListener(type: string, callback: (event: any) => void) { this.listeners.get(type)?.delete(callback); }
  emit(type: string, event = {}) { for (const callback of [...this.listeners.get(type) ?? []]) callback(event); }
  count() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const script = (html: string) => html.match(/<script type="module">([\s\S]*?)<\/script>/)![1];
function fixture(paths = ["lynk/room/alice", "lynk/other/bob"]) {
  const routes = new Signal(new Map(paths.map((path) => [path, {}])));
  const connections: any[] = [], players: any[] = [], posts: any[] = [], imports: string[] = [];
  const failures = { player: false };
  const stage = { className: "", children: new Set<any>(), appendChild(canvas: any) { this.children.add(canvas); } };
  const window = Object.assign(new Events(), { ReactNativeWebView: { postMessage: (json: string) => posts.push(JSON.parse(json)) } });
  const document = Object.assign(new Events(), {
    getElementById: () => stage,
    createElement: () => ({ remove() { stage.children.delete(this); } }),
  });
  class Connection {
    props: any; closed = 0;
    status = new Signal("connected"); origin = new Signal({ broadcasts: () => routes }); probe = new Signal(undefined);
    constructor(props: any) { this.props = props; connections.push(this); }
    close() { this.closed++; }
  }
  class Player {
    props: any; closed = 0;
    constructor(props: any) {
      if (failures.player) throw new Error("Player setup failed");
      assert.ok(props.origin instanceof Signal); assert.ok(props.probe instanceof Signal);
      assert.ok(props.canvas instanceof Signal); assert.ok(props.muted instanceof Signal); assert.ok(props.volume instanceof Signal);
      assert.equal(props.delay, 0); this.props = props; players.push(this);
    }
    close() { this.closed++; }
  }
  const loadModule = async (url: string) => {
    imports.push(url);
    if (url.includes("/@moq/net@0.4.3")) return { Connection, Signals: { Signal }, Path: { from: (path: string) => path }, Time: { Milli: { zero: 0 } } };
    assert.match(url, /\/@moq\/watch@0\.6\.2\?/);
    return { Player };
  };
  const source = script(buildMoqPlayerHtml({ relayUrl: "https://relay.invalid", namespace: "lynk/room" }));
  // Parse the exact generated module body first, then replace only import calls
  // so the same program can execute without contacting a CDN or real relay.
  const run = (loader = loadModule) => {
    new AsyncFunction(source);
    return new AsyncFunction("window", "document", "loadModule", source.replace(/\bimport\(/g, "loadModule("))(window, document, loader);
  };
  return { window, document, routes, connections, players, posts, imports, stage, run, loadModule, failures };
}

test("WebView uses pinned released APIs, initial discovery, controls and complete teardown", async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.imports, ["https://esm.sh/@moq/net@0.4.3?deps=@moq/signals@0.2.5", "https://esm.sh/@moq/watch@0.6.2?deps=@moq/net@0.4.3,@moq/signals@0.2.5"]);
  assert.equal(f.connections.length, 1); assert.equal(f.connections[0].props.share, false); assert.equal(f.connections[0].props.linger, 0);
  assert.deepEqual(f.posts[0], { type: "status", status: "connected" });
  assert.deepEqual(f.posts.at(-1), { type: "announced", paths: ["lynk/room/alice"] });
  assert.equal(f.players.length, 1); assert.equal(f.stage.children.size, 1);
  f.window.emit("message", { data: JSON.stringify({ type: "control", muted: true, volume: 3 }) });
  assert.equal(f.players[0].props.muted.peek(), true); assert.equal(f.players[0].props.volume.peek(), 1);
  f.document.emit("message", { data: JSON.stringify({ type: "control", volume: -1 }) });
  assert.equal(f.players[0].props.volume.peek(), 0);
  f.routes.set(new Map([["lynk/room/charlie", {}], ["lynk/room/dana", {}]]));
  assert.equal(f.players[0].closed, 1); assert.equal(f.stage.className, "two"); assert.equal(f.stage.children.size, 2);
  f.window.emit("pagehide"); f.window.emit("beforeunload");
  assert.ok(f.players.every((player) => player.closed === 1)); assert.equal(f.connections[0].closed, 1);
  assert.equal(f.stage.children.size, 0); assert.equal(f.routes.listeners.size, 0);
  assert.equal(f.connections[0].origin.listeners.size, 0); assert.equal(f.connections[0].status.listeners.size, 0);
  assert.equal(f.window.count(), 0); assert.equal(f.document.count(), 0);
  f.routes.set(new Map([["lynk/room/late", {}]])); assert.equal(f.players.length, 3);
});

test("WebView rewires origin discovery on reconnect without retaining old subscriptions", async () => {
  const f = fixture(); await f.run();
  const next = new Signal(new Map([["lynk/room/bob", {}]]));
  f.connections[0].origin.set({ broadcasts: () => next });
  assert.equal(f.routes.listeners.size, 0); assert.equal(next.listeners.size, 1);
  assert.equal(f.players[0].closed, 1); assert.equal(f.players.at(-1).props.name, "lynk/room/bob");
  f.connections[0].origin.set(undefined);
  assert.equal(next.listeners.size, 0); assert.equal(f.stage.children.size, 0);
  f.window.emit("pagehide");
});

test("WebView navigation during imports never opens a connection", async () => {
  const f = fixture();
  await f.run(async (url: string) => { f.window.emit("pagehide"); return f.loadModule(url); });
  assert.equal(f.connections.length, 0); assert.equal(f.players.length, 0); assert.equal(f.window.count(), 0);
});

test("WebView import failure reports its error and removes lifecycle listeners", async () => {
  const f = fixture(); await f.run(async () => { throw new Error("CDN unavailable"); });
  assert.deepEqual(f.posts, [{ type: "error", message: "CDN unavailable" }]); assert.equal(f.window.count(), 0);
});

test("WebView configuration and CDN cannot escape the inline module", () => {
  const attack = '</script><script>throw "injected"</script>\u2028\u2029';
  const html = buildMoqPlayerHtml({ relayUrl: `https://relay.invalid/${attack}`, namespace: attack, cdn: `https://cdn.invalid/${attack}` });
  assert.equal((html.match(/<script/g) ?? []).length, 1); assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.ok(!html.includes(attack)); assert.match(html, /\\u003c\/script>/); new AsyncFunction(script(html));
});


test("WebView player construction failure releases transport without installing controls afterward", async () => {
  const f = fixture(); f.failures.player = true; await f.run();
  assert.deepEqual(f.posts.at(-1), { type: "error", message: "Player setup failed" });
  assert.equal(f.connections[0].closed, 1); assert.equal(f.routes.listeners.size, 0);
  assert.equal(f.stage.children.size, 0); assert.equal(f.window.count(), 0); assert.equal(f.document.count(), 0);
});
