import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
const { registerHooks } = createRequire(import.meta.url)("node:module");

let slots: any[], cursor: number, pending: Array<() => void>, dirty: boolean;
let callbacks: any;
let run: () => any;
const subscriptions: any[] = [];
const fakeReact = {
  useRef(value: unknown) { const i = cursor++; return slots[i] ??= { current: value }; },
  useState(value: unknown) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = value;
    return [slots[i], (next: any) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; dirty = true; }];
  },
  useEffect(effect: () => any, deps: any[]) {
    const i = cursor++;
    const old = slots[i];
    if (!old || deps.some((d, n) => !Object.is(d, old.deps[n]))) {
      pending.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
    }
  },
};
(globalThis as any).__rosterReact = fakeReact;
(globalThis as any).__rosterApi = { subscribeToMembers(_room: string, _change: unknown, options: any) {
  callbacks = options; subscriptions.push(options); return () => {};
} };
const url = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const mockReact = url('export const {useRef,useState,useEffect} = globalThis.__rosterReact;');
const mockApi = url('export const videoApi = globalThis.__rosterApi;');
const hooks = registerHooks({ resolve(specifier: string, context: any, next: any) {
  if (context.parentURL?.includes("useRoomMembers.ts")) {
    if (specifier === "react") return { url: mockReact, shortCircuit: true };
    if (specifier === "../../video/api") return { url: mockApi, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { useRoomMembers } = await import("../hooks/useRoomMembers.ts");
after(() => hooks.deregister());
function render(fn = run): ReturnType<typeof useRoomMembers> {
  run = fn;
  let result: any;
  do { dirty = false; cursor = 0; pending = []; result = fn(); for (const apply of pending) apply(); } while (dirty);
  return result;
}
function reset() { slots = []; cursor = 0; subscriptions.length = 0; }

test("missing roster RPC never becomes a successful empty room; restoration recovers", () => {
  reset();
  assert.equal(render(() => useRoomMembers("room", "host", true)).ready, false);
  callbacks.onError({ code: "PGRST202", status: 404 });
  const failed = render();
  assert.equal(failed.error, true);
  assert.equal(failed.ready, false);
  const members = [{ userId: "host", status: "active" }, { userId: "guest", status: "active" }];
  callbacks.onSync(members);
  assert.deepEqual(render(), { members, ready: true, error: false });
});

test("later polling failures preserve the last good roster and readiness", () => {
  reset(); render(() => useRoomMembers("room", "host", true));
  const members = [{ userId: "host", status: "active" }];
  callbacks.onSync(members); render();
  callbacks.onError(new Error("offline"));
  const result = render();
  assert.equal(result.ready, true);
  assert.equal(result.members, members);
  assert.equal(result.error, true);
});

test("room/account switches and re-enabling wait for their own fresh snapshot", () => {
  reset(); render(() => useRoomMembers("room", "host", true));
  const old = callbacks;
  old.onSync([{ userId: "host" }]); render();
  assert.equal(render(() => useRoomMembers("other", "guest", true)).ready, false);
  old.onSync([{ userId: "host" }]);
  assert.equal(render().ready, false);
  callbacks.onSync([{ userId: "guest" }]); assert.equal(render().ready, true);
  render(() => useRoomMembers("other", "guest", false));
  assert.equal(render(() => useRoomMembers("other", "guest", true)).ready, false);
});

for (const [description, nextRoom, nextUser] of [
  ["room only", "other", "host"],
  ["account only", "room", "guest"],
]) {
  test(`${description} changes discard stale members, errors and callbacks`, () => {
    reset(); render(() => useRoomMembers("room", "host", true));
    const old = callbacks;
    old.onSync([{ userId: "host" }]); render();
    old.onError(new Error("old failure")); render();
    assert.deepEqual(render(() => useRoomMembers(nextRoom, nextUser, true)), { members: [], ready: false, error: false });
    old.onSync([{ userId: "stale" }]); old.onError(new Error("late failure"));
    assert.deepEqual(render(), { members: [], ready: false, error: false });
    const members = [{ userId: nextUser }];
    callbacks.onSync(members);
    assert.deepEqual(render(), { members, ready: true, error: false });
  });
}

test("both room screens show initial roster failure without altering publication authority", () => {
  const web = readFileSync(new URL("../screens/room.web.tsx", import.meta.url), "utf8");
  const native = readFileSync(new URL("../../routes/screens/(protected)/sneaky-lynk/room/[id].tsx", import.meta.url), "utf8");
  const nativeHook = readFileSync(new URL("../../video/hooks/useVideoRoom.ts", import.meta.url), "utf8");
  assert.match(web, /\{admitted && !rosterReady && \(/);
  assert.doesNotMatch(web, /if \(admitted && !rosterReady\)/);
  assert.match(web, /\{rosterReady && stageTiles\.length === 1 \? \(/);
  assert.match(native, /rosterStatus=\{videoRoom.isAdmitted && !videoRoom.rosterReady/);
  assert.doesNotMatch(native, /if \(videoRoom.isAdmitted && !videoRoom.rosterReady\)/);
  assert.match(native, /<RoomStage/);
  // The responsive layout measures the remaining stage above its in-flow dock.
  // Require the notice conditional to close before that wrapper begins; ordering
  // alone could pass even if the notice were accidentally nested in the stage.
  assert.match(native, /\{rosterStatus \? \([\s\S]*?\) : null\}\s*<View\s+className="flex-1"\s+style=\{\{ minHeight: 0 \}\}\s+onLayout=\{\(e\) => \{[\s\S]*?setStageContentHeight[\s\S]*?<RoomStage[\s\S]*?stageHeight=\{stageContentHeight\}/);
  assert.match(native, /<RoomStage[\s\S]*?\/>\s*<\/View>\s*<RemoteAudioLayer[^>]*\/>\s*<ControlsBar/);
  assert.match(native, /onToggleMic=\{handleToggleMic\}/);
  assert.match(web, /import \{ RoomStage \} from "\.\.\/ui\/web\/RoomStage"/);
  assert.match(web, /<RoomStage tiles=\{stageTiles\} \/>/);
  const webStage = readFileSync(new URL("../ui/web/RoomStage.tsx", import.meta.url), "utf8");
  assert.match(webStage, /tiles\.map\(\(tile\) => \{[\s\S]*?key=\{tile.key\}[\s\S]*?<StageTile tile=\{tile\} \/>/);
  for (const source of [web, native]) assert.match(source, /Your camera and microphone controls remain active below/);
  for (const source of [web, native]) assert.match(source, /Couldn't load participants/);
  for (const source of [web, nativeHook]) assert.match(source, /const canPublish = admitted && isPublisherRole\(localRole\)/);
  assert.match(nativeHook, /ready: previous.key === key && previous.ready/);
  assert.match(nativeHook, /rosterState.key === admissionKey && rosterState.ready/);
});
