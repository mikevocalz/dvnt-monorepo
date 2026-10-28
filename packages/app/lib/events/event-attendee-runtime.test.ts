import { URL } from "node:url";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as policy from "./event-attendee-visibility.ts";
import * as pages from "./attendee-page.ts";
import * as types from "./event-type.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function moduleAt(relative: string, overrides: Record<string, any> = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { fileName: relative, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const context = { exports: {} as any, require: (id: string) => {
    if (id in overrides) return overrides[id];
    if (id.endsWith("event-attendee-visibility")) return policy;
    if (id.endsWith("attendee-page")) return pages;
    if (id.endsWith("event-type")) return types;
    return require(id);
  }, console, setTimeout, clearTimeout };
  vm.runInNewContext(compiled.outputText, context);
  return context.exports;
}

function storeFixture() {
  let calls = 0;
  let resolvePage!: (rows: unknown[]) => void;
  let rejectPage!: (error: Error) => void;
  const offsets: number[] = [];
  const api = { getEventAttendeePage: (_id: string, opts: { offset: number }) => { calls++; offsets.push(opts.offset); return new Promise((resolve, reject) => { resolvePage = resolve; rejectPage = reject; }); } };
  let session = { epoch: 1, ready: true, authId: "account-a" };
  let onBoundary: (() => void) | undefined;
  const { useEventAttendeesStore: store } = moduleAt("../stores/event-attendees-store.ts", {
    "@dvnt/app/lib/api/events": { eventsApi: api },
    "@dvnt/app/lib/auth/session-lifecycle": {
      getSessionLifecycle: () => session,
      subscribeSessionLifecycle: (listener: () => void) => { onBoundary = listener; return () => {}; },
    },
  });
  return { store, calls: () => calls, offsets, finish: (rows: unknown[]) => resolvePage(rows), fail: () => rejectPage(new Error("temporary offline")),
    switchAccount: (authId: string, ready = true) => { session = { epoch: session.epoch + 1, authId, ready }; onBoundary?.(); },
  };
}
const person = { id: "person", username: "private-person", avatar: "https://example.invalid/private.jpg" };
const protectedEvent = { category: "sex_party" };

test("hidden store refuses seeds and paging requests", async () => {
  const h = storeFixture();
  h.store.getState().seed("1", [person], protectedEvent);
  await h.store.getState().loadMore("1", "public", protectedEvent);
  assert.equal(h.calls(), 0);
  assert.equal(h.store.getState().byEvent["1"].rows.length, 0);
});

test("opt-out purges loaded rows and rejects a response already in flight", async () => {
  const h = storeFixture();
  const event = { ...protectedEvent, showAttendees: true };
  h.store.getState().seed("1", [person], event);
  const pending = h.store.getState().loadMore("1", "public", event);
  assert.equal(h.calls(), 1);
  h.store.getState().setAllowed("1", false);
  assert.equal(h.store.getState().byEvent["1"].rows.length, 0);
  h.finish([{ ...person, id: "late" }]); await pending;
  assert.equal(h.store.getState().byEvent["1"].rows.length, 0);
});

test("opt-out then opt-in does not resurrect a pre-opt-out response", async () => {
  const h = storeFixture();
  const event = { lynkRoomId: "room", showAttendees: true };
  h.store.getState().seed("1", [person], event);
  const pending = h.store.getState().loadMore("1", "public", event);
  h.store.getState().setAllowed("1", false);
  h.store.getState().setAllowed("1", true);
  h.finish([{ ...person, id: "late" }]); await pending;
  assert.equal(h.store.getState().byEvent["1"].rows.length, 0);
});

test("ordinary and explicitly opted-in events can seed and page normally", async () => {
  for (const event of [{ category: "party", showAttendees: false }, { ...protectedEvent, showAttendees: true }]) {
    const h = storeFixture();
    h.store.getState().seed("1", [person], event);
    const pending = h.store.getState().loadMore("1", "public", event);
    h.finish([{ ...person, id: "next" }]); await pending;
    assert.equal(h.store.getState().byEvent["1"].rows.length, 2);
  }
});

function wrapper(relative: string, native: boolean) {
  let seeded = 0;
  const icon = () => null;
  const state = { setAllowed() {}, seed() { seeded++; }, loadMore() { seeded++; } };
  const useStore = (selector: any) => selector(state);
  const mocks: Record<string, any> = {
    "@dvnt/app/lib/stores/event-attendees-store": { useEventAttendeesStore: useStore, selectAttendees: () => () => ({ rows: [person], loading: false, lastPageSize: 0 }) },
    "@dvnt/app/lib/stores/auth-store": { useAuthStore: (fn: any) => fn({ isAuthenticated: true }) },
    "lucide-react": { Lock: icon, ChevronDown: icon },
  };
  if (native) Object.assign(mocks, {
    "react-native": { View: "div", Text: "span", Pressable: "button", StyleSheet: { create: (s: any) => s } },
    "expo-image": { Image: ({ source, style }: any) => React.createElement("img", { src: source?.uri, style }) }, "expo-blur": { BlurView: "div" },
    "lucide-react-native": { Lock: icon, ChevronDown: icon },
    "react-native-reanimated": { __esModule: true, default: { View: "div" }, useSharedValue: () => ({ value: 0 }), useAnimatedStyle: () => ({}), withTiming: (x: any) => x, interpolate: () => 0 },
    "@dvnt/app/lib/stores/event-detail-screen-store": { useEventDetailScreenStore: (fn: any) => fn({ attendeesExpanded: false, setAttendeesExpanded() {} }) },
    "@dvnt/app/components/list": { LegendList: () => null },
  });
  return { Component: moduleAt(relative, mocks).GoingAccordion, seeded: () => seeded };
}

test("actual web and native accordions render no identity, heading, teaser, or empty-state while hidden", () => {
  for (const [relative, native] of [["../../components/event/GoingAccordion.web.tsx", false], ["../../features/events/ui/GoingAccordion.tsx", true]] as const) {
    const h = wrapper(relative, native);
    for (const event of [protectedEvent, { lynkRoomId: "room" }, { ...protectedEvent, showAttendees: null }]) {
      const html = renderToStaticMarkup(React.createElement(h.Component, { event, id: "1", eventId: "1", attendees: [person], totalCount: 1, isLoggedIn: false }));
      assert.equal(html, "");
      assert.equal(h.seeded(), 0);
    }
    for (const event of [{ category: "party", showAttendees: false }, { ...protectedEvent, showAttendees: true }]) {
      const html = renderToStaticMarkup(React.createElement(h.Component, { event, id: "1", attendees: [person], totalCount: 1, isLoggedIn: true }));
      assert.match(html, /private-person|private\.jpg/);
    }
  }
});


test("account A to B and sign-out clear loaded rows and reject A's late page", async () => {
  for (const account of ["account-b", ""]) {
    const h = storeFixture();
    const event = { ...protectedEvent, showAttendees: true };
    h.store.getState().seed("1", [person], event);
    const pending = h.store.getState().loadMore("1", "public", event);
    h.switchAccount(account, !!account);
    assert.equal(Object.keys(h.store.getState().byEvent).length, 0);
    h.finish([{ ...person, id: "late" }]); await pending;
    assert.equal(Object.keys(h.store.getState().byEvent).length, 0);
    h.store.getState().seed("1", [], event);
    assert.equal(h.store.getState().byEvent["1"]?.rows.length ?? 0, 0);
  }
});

test("an authoritative empty detail roster revokes pages and invalidates in-flight work", async () => {
  const h = storeFixture();
  const event = { ...protectedEvent, showAttendees: true };
  h.store.getState().seed("1", [person], event);
  const pending = h.store.getState().loadMore("1", "public", event);
  h.store.getState().seed("1", [], event);
  assert.equal(h.store.getState().byEvent["1"].rows.length, 0);
  assert.equal(h.store.getState().byEvent["1"].lastPageSize, 0);
  h.finish([{ ...person, id: "late" }]); await pending;
  assert.equal(h.store.getState().byEvent["1"].rows.length, 0);
});


test("an empty authoritative roster hides old paged identities before effects run", () => {
  for (const [relative, native] of [["../../components/event/GoingAccordion.web.tsx", false], ["../../features/events/ui/GoingAccordion.tsx", true]] as const) {
    const h = wrapper(relative, native);
    const html = renderToStaticMarkup(React.createElement(h.Component, {
      event: { ...protectedEvent, showAttendees: true }, id: "1", eventId: "1", attendees: [], totalCount: 1, isLoggedIn: true,
    }));
    assert.doesNotMatch(html, /private-person|private\.jpg/);
  }
});


test("failed paging keeps the cursor and rows for an explicit retry", async () => {
  const h = storeFixture();
  const event = { category: "party" };
  h.store.getState().seed("1", [person], event);
  const failed = h.store.getState().loadMore("1", "public", event);
  h.fail(); await failed;
  let entry = h.store.getState().byEvent["1"];
  assert.equal(entry.error, true);
  assert.equal(entry.lastPageSize, null);
  assert.equal(entry.rows.length, 1);
  const retried = h.store.getState().loadMore("1", "public", event);
  h.finish([{ ...person, id: "next" }]); await retried;
  entry = h.store.getState().byEvent["1"];
  assert.deepEqual(h.offsets, [1, 1]);
  assert.equal(entry.error, false);
  assert.equal(entry.rows.length, 2);
  assert.equal(entry.lastPageSize, 1);
});

test("a newer detail roster reopens an exhausted preview without losing loaded identities", async () => {
  const h = storeFixture();
  const event = { category: "party" };
  h.store.getState().seed("1", [person], event);
  const done = h.store.getState().loadMore("1", "public", event);
  h.finish([]); await done;
  assert.equal(h.store.getState().byEvent["1"].lastPageSize, 0);
  h.store.getState().seed("1", [person, { ...person, id: "new" }], event);
  assert.equal(h.store.getState().byEvent["1"].lastPageSize, null);
  assert.equal(h.store.getState().byEvent["1"].rows.length, 2);
});


test("the actual attendee API preserves errors instead of converting them to a final empty page", async () => {
  const file = "../api/events.ts";
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let method: any;
  const visit = (node: any) => {
    if (ts.isMethodDeclaration(node) && node.name?.getText(ast) === "getEventAttendeePage") method = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(method);
  const code = ts.transpileModule(`exports.api = {${method.getText(ast)}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  for (const failure of ["none", "rpc", "malformed"]) {
    const error = new Error("RPC unavailable");
    const calls: any[] = [];
    const context = { exports: {} as any, console: { error() {} }, supabase: { rpc: async (...args: any[]) => { calls.push(args); return failure === "rpc" ? { error } : { data: failure === "malformed" ? {} : [] }; } } };
    vm.runInNewContext(code, context);
    const result = context.exports.api.getEventAttendeePage("42", { limit: 24, offset: 4 });
    if (failure !== "none") await assert.rejects(result, /RPC unavailable|Invalid attendee page response/);
    else assert.equal((await result).length, 0);
    assert.equal(calls[0][0], "get_event_attendee_page");
    assert.equal(calls[0][1].p_offset, 4);
  }
});


test("a failed second page keeps its full-page cursor and retries from the same offset", async () => {
  const h = storeFixture();
  const event = { category: "party" };
  h.store.getState().seed("1", [person], event);
  const first = h.store.getState().loadMore("1", "public", event);
  h.finish(Array.from({ length: 24 }, (_, i) => ({ ...person, id: String(i) }))); await first;
  const second = h.store.getState().loadMore("1", "public", event);
  h.fail(); await second;
  assert.equal(h.store.getState().byEvent["1"].lastPageSize, 24);
  assert.equal(h.store.getState().byEvent["1"].rows.length, 25);
  const retry = h.store.getState().loadMore("1", "public", event);
  h.finish([{ ...person, id: "last" }]); await retry;
  assert.deepEqual(h.offsets, [1, 25, 25]);
  assert.equal(h.store.getState().byEvent["1"].rows.length, 26);
});

test("late page failures cannot resurrect an opted-out or previous-account roster", async () => {
  for (const boundary of ["privacy", "account"]) {
    const h = storeFixture();
    const event = { ...protectedEvent, showAttendees: true };
    h.store.getState().seed("1", [person], event);
    const pending = h.store.getState().loadMore("1", "public", event);
    if (boundary === "privacy") h.store.getState().setAllowed("1", false);
    else h.switchAccount("account-b");
    h.fail(); await pending;
    const entry = h.store.getState().byEvent["1"];
    assert.equal(entry?.rows.length ?? 0, 0);
    assert.equal(entry?.error ?? false, false);
  }
});


test("an authoritative empty seed also clears a prior paging error", async () => {
  const h = storeFixture();
  const event = { category: "party" };
  h.store.getState().seed("1", [], event);
  const pending = h.store.getState().loadMore("1", "public", event);
  h.fail(); await pending;
  assert.equal(h.store.getState().byEvent["1"].error, true);
  h.store.getState().seed("1", [], event);
  assert.equal(h.store.getState().byEvent["1"].error, false);
});
