import { URL } from "node:url";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { eventTypeUpdate, storedEventType, realtimeEventType } from "./event-type.ts";
import { canShowEventAttendees, isSensitiveAttendanceEvent, sanitizeEventAttendance } from "./event-attendee-visibility.ts";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const { QueryClient, QueryObserver, isCancelledError } = require("@tanstack/react-query");

function loadFunctions(path: string, names: string[], globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const declarations = names.map(name => tree.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === name));
  declarations.forEach((d: any) => assert.ok(d));
  const code = ts.transpileModule(declarations.map((d: any) => d.getText(tree)).join("\n") + `\nexports.fns = {${names.join(",")}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context: any = { exports: {}, ...globals };
  vm.runInNewContext(code, context);
  return context.exports.fns;
}
const { buildEventCachePatch: patch } = loadFunctions("../hooks/use-events.ts", ["buildEventCachePatch"], { eventTypeUpdate, isSensitiveAttendanceEvent });
const { normalizeEvent: normalize } = loadFunctions("../normalization/safe-entity.ts", ["normalizeEvent"], { storedEventType, sanitizeEventAttendance });
const { patchEntityInQueryData: patchEntity, propagateEntity, queryContainsEntity } = loadFunctions("../cache/propagate.ts", ["patchEntityInQueryData", "applyEntityPatch", "patchPageData", "nestedKeyFor", "matches", "propagateEntity", "queryContainsEntity", "queryDataContains"], {
  sanitizeEventAttendance, LIST_FIELDS: ["data", "items", "events", "posts", "tickets", "users", "comments"],
});
const privateProfile = { id: "person", username: "private-person" };
const old = { id: "1", event_type: "party", category: "party", showAttendees: true, show_attendees: true, attendeeAvatars: [privateProfile], attendees: [privateProfile], totalAttendees: 20, friendsGoing: 3, friends_going: 3 };

test("normalization preserves privacy classification and respects explicit alias clearing", () => {
  for (const input of [{ lynkRoomId: "room" }, { lynk_room_id: "room" }]) {
    const event = normalize({ ...old, showAttendees: false, show_attendees: false, ...input });
    assert.equal(event.lynkRoomId, "room");
    assert.equal(isSensitiveAttendanceEvent(event), true);
    assert.equal(event.attendeeAvatars.length, 0);
    assert.equal(event.attendees, 20);
  }
  assert.equal(normalize({ id: "1", lynk_room_id: null, lynkRoomId: "stale" }).lynkRoomId, null);
  const legacy = normalize({ id: "1", event_type: null, eventType: "sex_party", category: "music" });
  assert.equal(isSensitiveAttendanceEvent(legacy), false);
});

test("optimistic classification changes reset inherited opt-in and synchronize canonical fields", () => {
  const sensitive = { ...old, ...patch({ category: "sex_party" }) };
  assert.equal(sensitive.event_type, "sex_party");
  assert.equal(canShowEventAttendees(sensitive), false);
  assert.equal(canShowEventAttendees({ ...old, ...patch({ category: "sex_party", showAttendees: true }) }), true);
  assert.equal(canShowEventAttendees({ ...sensitive, ...patch({ category: "party" }) }), true);
  assert.equal(canShowEventAttendees({ ...sensitive, ...patch({ category: "music" }) }), true);
  assert.equal(canShowEventAttendees({ ...old, ...patch({ lynkRoomId: "room" }) }), false);
  assert.equal(canShowEventAttendees({ ...sensitive, ...patch({ category: "music", lynkRoomId: null }) }), true);
});

test("event cache propagation purges profiles while preserving counts, including ticket envelopes", () => {
  const privacyPatch = patch({ category: "sex_party" });
  for (const container of [old, [old], { events: [old] }, { pages: [{ events: [old] }] }, { id: "ticket", event_id: "1", event: old }, [{ id: "ticket", event_id: "1", event: old }]]) {
    const updated = patchEntity(container, "event", "1", privacyPatch);
    assert.equal(JSON.stringify(updated).includes("private-person"), false);
    assert.equal(JSON.stringify(updated).includes('"attendees":20'), true);
  }
  const collision = { id: "1", event_id: "2", event: { ...old, id: "2" } };
  assert.equal(patchEntity(collision, "event", "1", privacyPatch), collision);
  const unrelated = patchEntity(old, "user", "1", { name: "Unrelated" });
  assert.equal(unrelated.attendeeAvatars.length, 1);
});

const eventKeys = { all: ["events"], detail: (id: string) => ["events", "detail", id], list: () => ["events", "list"] };
function revisionTracker() {
  let boundary = () => {};
  const source = readFileSync(new URL("./event-attendee-revision.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context: any = { exports: {}, require: () => ({ subscribeSessionLifecycle: (callback: () => void) => { boundary = callback; } }) };
  vm.runInNewContext(code, context);
  return { ...context.exports, boundary: () => boundary() };
}
function realtime(client: any) {
  const allowed: boolean[] = [];
  const listeners: Array<{ filter: any; callback: (payload: any) => Promise<void> }> = [];
  const channel = { on: (_kind: string, filter: any, callback: any) => { listeners.push({ filter, callback }); return channel; }, subscribe: () => channel };
  const revision = revisionTracker();
  const fns = loadFunctions("../hooks/use-event-realtime.ts", ["applyRealtimeAttendeePrivacy", "useEventRealtime", "useEventsFeedRealtime"], {
    ...revision, canShowEventAttendees, sanitizeEventAttendance, propagateEntity, queryContainsEntity, eventKeys,
    useEventAttendeesStore: { getState: () => ({ setAllowed: (_id: string, value: boolean) => allowed.push(value) }) },
    useQueryClient: () => client, useEffect: (fn: () => void) => fn(), freshChannel: () => channel,
    supabase: { removeChannel() {} }, realtimeEventType, formatEventDate: () => null,
    isDiscoverableEvent: (row: any) => !["deleted", "cancelled"].includes(row.status),
  });
  return { ...fns, allowed, revision, listener: () => listeners.find(row => row.filter.table === "events" && row.filter.event === "UPDATE")!.callback };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("realtime opt-out immediately redacts detail/list/friend counts and revokes paged identities", async () => {
  const client = new QueryClient();
  const optedIn = { ...old, event_type: "sex_party", category: "sex_party" };
  client.setQueryData(eventKeys.detail("1"), optedIn);
  client.setQueryData(eventKeys.list(), [optedIn]);
  const rt = realtime(client);
  const pending = rt.applyRealtimeAttendeePrivacy(client, "1", { show_attendees: false });
  // This must happen synchronously, not after cancellation/refetch resolves.
  const detail: any = client.getQueryData(eventKeys.detail("1"));
  assert.equal(detail.show_attendees, false);
  assert.equal(detail.showAttendees, false);
  assert.equal(detail.attendeeAvatars.length, 0);
  assert.equal(detail.attendees, 20);
  assert.equal(detail.friendsGoing, 0);
  assert.equal(detail.friends_going, 0);
  assert.equal(JSON.stringify(client.getQueryData(eventKeys.list())).includes("private-person"), false);
  assert.deepEqual(rt.allowed, [false]);
  await pending;
  await rt.applyRealtimeAttendeePrivacy(client, "1", { event_type: "party", category: "music", lynk_room_id: "room", show_attendees: false });
  assert.equal(canShowEventAttendees(client.getQueryData(eventKeys.detail("1")) as any), false);
  await rt.applyRealtimeAttendeePrivacy(client, "1", { lynk_room_id: null });
  assert.equal(canShowEventAttendees(client.getQueryData(eventKeys.detail("1")) as any), true);
  client.clear();
});

for (const feed of [false, true]) {
  test(`real QueryClient ${feed ? "feed" : "detail"} listener cancels and restarts initial event/list/ticket responses`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const rt = realtime(client);
    if (feed) rt.useEventsFeedRealtime(); else rt.useEventRealtime("1");
    const hidden = sanitizeEventAttendance({ ...old, event_type: "sex_party", show_attendees: false });
    const fixtures = [
      { key: eventKeys.detail("1"), wrap: (event: any) => event },
      { key: eventKeys.list(), wrap: (event: any) => [event] },
      { key: ["tickets", "detail", "1"], wrap: (event: any) => ({ id: "ticket", event }) },
    ];
    const rows = fixtures.map(({ key, wrap }) => {
      let calls = 0;
      let finish!: (value: any) => void;
      const seen: string[] = [];
      const observer = new QueryObserver(client, { queryKey: key, queryFn: () => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(wrap(hidden)) });
      const unsubscribe = observer.subscribe((result: any) => { if (result.data) seen.push(JSON.stringify(result.data)); });
      return { key, wrap, finish, calls: () => calls, seen, unsubscribe };
    });
    await rt.listener()({ new: { id: "1", status: "published", event_type: "sex_party", show_attendees: false } });
    for (const row of rows) row.finish(row.wrap({ ...old, event_type: "sex_party" }));
    await tick();
    for (const row of rows) {
      assert.equal(row.calls(), 2, `canceled query restarted: ${JSON.stringify(row.key)}`);
      assert.equal(JSON.stringify(client.getQueryData(row.key)).includes("private-person"), false);
      assert.equal(row.seen.some(value => value.includes("private-person")), false);
      row.unsubscribe();
    }
    client.clear();
  });
}

test("feed cancellation/removal path still restarts pending lists", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const rt = realtime(client);
  rt.useEventsFeedRealtime();
  let calls = 0;
  let finish!: (value: any) => void;
  const observer = new QueryObserver(client, { queryKey: eventKeys.list(), queryFn: () => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([]) });
  const unsubscribe = observer.subscribe(() => {});
  await rt.listener()({ new: { id: "1", status: "cancelled", event_type: "sex_party", show_attendees: false } });
  finish([old]);
  await tick();
  assert.equal(calls, 2);
  assert.deepEqual(client.getQueryData(eventKeys.list()), []);
  unsubscribe(); client.clear();
});

function startBootstrap(client: any, response: Promise<any>, session: { epoch: number; ready: boolean }) {
  const authStore = Object.assign((selector: any) => selector({ user: { id: "viewer" } }), { getState: () => ({ user: { id: "viewer" } }) });
  const { useBootstrapEvents } = loadFunctions("../hooks/use-bootstrap-events.ts", ["bootstrapEventsForCache", "useBootstrapEvents"], {
    sanitizeEventAttendance, storedEventType, useQueryClient: () => client, useAuthStore: authStore,
    useRef: () => ({ current: false }), useEffect: (fn: () => void) => fn(),
    useScreenTrace: () => ({ markCacheHit() {}, markUsable() {} }), isFeatureEnabled: () => true,
    getSessionLifecycle: () => ({ ...session }), bootstrapApi: { events: () => response }, eventKeys, isCancelledError,
    console: { warn() {} },
  });
  useBootstrapEvents();
}

test("bootstrap initial response cannot rehydrate identities after realtime opt-out", async () => {
  const client = new QueryClient();
  let finish!: (data: any) => void;
  startBootstrap(client, new Promise(resolve => { finish = resolve; }), { epoch: 1, ready: true });
  await realtime(client).applyRealtimeAttendeePrivacy(client, "1", { event_type: "sex_party", show_attendees: false });
  finish({ events: [{ ...old, event_type: "sex_party" }] });
  await tick();
  assert.equal(client.getQueryData(eventKeys.list()), undefined);
  client.clear();
});

test("bootstrap sanitizes success, discards old sessions, and never caches a failed bootstrap as an empty list", async () => {
  for (const kind of ["success", "session-change", "failure"]) {
    const client = new QueryClient();
    const session = { epoch: 1, ready: true };
    let finish!: (data: any) => void;
    startBootstrap(client, new Promise(resolve => { finish = resolve; }), session);
    if (kind === "session-change") session.epoch++;
    finish(kind === "failure" ? null : { events: [{ ...old, event_type: "sex_party", show_attendees: false }] });
    await tick();
    const data = client.getQueryData(eventKeys.list());
    if (kind === "success") {
      assert.equal(JSON.stringify(data).includes("private-person"), false);
      assert.equal((data as any[])[0].friendsGoing, 0);
    } else assert.equal(data, undefined);
    client.clear();
  }
});

test("newer realtime decisions and session changes invalidate older awaiting handlers", async () => {
  const client = new QueryClient();
  const rt = realtime(client);
  client.setQueryData(eventKeys.detail("1"), { ...old, event_type: "sex_party" });
  const older = rt.applyRealtimeAttendeePrivacy(client, "1", { show_attendees: true });
  const newer = rt.applyRealtimeAttendeePrivacy(client, "1", { show_attendees: false });
  assert.equal(await older, false);
  assert.equal(await newer, true);
  assert.equal(canShowEventAttendees(client.getQueryData(eventKeys.detail("1")) as any), false);
  const beforeSwitch = rt.applyRealtimeAttendeePrivacy(client, "1", { show_attendees: false });
  rt.revision.boundary();
  assert.equal(await beforeSwitch, false);
  client.clear();
});

test("privacy revisions isolate events and invalidate all callbacks at a session boundary", () => {
  const revisions = revisionTracker();
  const a = revisions.advanceEventAttendanceRevision("a");
  revisions.advanceEventAttendanceRevision("b");
  assert.equal(revisions.getEventAttendanceRevision("a"), a);
  revisions.boundary();
  assert.notEqual(revisions.getEventAttendanceRevision("a"), a);
  assert.ok(revisions.advanceEventAttendanceRevision("a") > a);
});

test("persisted query caches predating attendee privacy are invalidated", () => {
  const source = readFileSync(new URL("../query-persistence.ts", import.meta.url), "utf8");
  assert.match(source, /buster: "v12"/);
  assert.match(source, /currentVersion = "v12"/);
});
