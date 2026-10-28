// Render the real web accordion with its real paging store. Only the API/auth
// boundaries are fixtures; no attendee data or live requests are used.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import vm from "node:vm";
import * as policy from "../packages/app/lib/events/event-attendee-visibility.ts";
import * as pages from "../packages/app/lib/events/attendee-page.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
function load(relative: string, overrides: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../packages/app/lib/events/${relative}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { fileName: relative, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const context = { exports: {} as any, require: (id: string) => {
    if (id in overrides) return overrides[id];
    if (id.endsWith("event-attendee-visibility")) return policy;
    if (id.endsWith("attendee-page")) return pages;
    return require(id);
  }, console };
  vm.runInNewContext(code, context);
  return context.exports;
}
const person = (id: number) => ({ id: String(id), username: `member-${id}` });
const four = [1, 2, 3, 4].map(person);
let dom: any, root: any, Component: any, store: any, props: any;
let requests: Array<{ eventId: string; offset: number; limit: number }>;
let respond: (offset: number) => Promise<unknown[]>;
let navigate: string[];
let session: { epoch: number; ready: boolean };
let boundary: () => void;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://fixture.invalid/events/42' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.getElementById("root"));
  requests = []; navigate = []; session = { epoch: 1, ready: true };
  respond = async () => [];
  ({ useEventAttendeesStore: store } = load("../stores/event-attendees-store.ts", {
    "@dvnt/app/lib/api/events": { eventsApi: { getEventAttendeePage: (eventId: string, options: { offset: number; limit: number }) => {
      requests.push({ eventId, offset: options.offset, limit: options.limit }); return respond(options.offset);
    } } },
    "@dvnt/app/lib/auth/session-lifecycle": {
      getSessionLifecycle: () => session,
      subscribeSessionLifecycle: (fn: () => void) => { boundary = fn; },
    },
  }));
  ({ GoingAccordion: Component } = load("../../components/event/GoingAccordion.web.tsx", {
    "@dvnt/app/lib/stores/event-attendees-store": { useEventAttendeesStore: store, selectAttendees: (id: string) => (state: any) => state.byEvent[id] ?? empty },
    "@dvnt/app/lib/stores/auth-store": { useAuthStore: (select: any) => select({ isAuthenticated: true }) },
    "lucide-react": { Lock: () => null, ChevronDown: () => null },
  }));
  props = { event: { category: "party" }, id: "42", eventId: "42", attendees: four,
    totalCount: 45, isLoggedIn: true, onAttendeePress: (row: any) => navigate.push(row.username) };
});
const empty = { rows: [], loading: false, error: false, lastPageSize: null };
afterEach(async () => { await React.act(async () => root.unmount()); dom.window.close(); });
const render = async () => React.act(async () => root.render(React.createElement(Component, props)));
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.textContent?.includes(label));
async function click(node: any) { assert.ok(node, "button exists"); await React.act(async () => node.click()); }
const header = () => document.querySelector<HTMLButtonElement>("button[aria-expanded]");

test("45 going and four member profiles explains the mismatch without inventing identities", async () => {
  await render();
  assert.equal(requests.length, 0);
  assert.match(header()?.textContent ?? "", /45 going/);
  assert.match(header()?.textContent ?? "", /Tap to see member profiles/);
  await click(header());
  assert.deepEqual(requests, [{ eventId: "42", offset: 4, limit: 24 }]);
  assert.match(document.body.textContent ?? "", /4 member profiles shown/);
  assert.match(document.body.textContent ?? "", /guest and additional tickets may not have a member profile/);
  assert.equal(document.querySelectorAll('button').length, 5);
  await click(button("member-3"));
  assert.deepEqual(navigate, ["member-3"]);
  await click(header()); await click(header());
  assert.equal(requests.length, 1, "reopening a complete roster does not refetch forever");
});

test("opening a short non-scrollable preview pages through every member, including the last page", async () => {
  const all = Array.from({ length: 45 }, (_, i) => person(i + 1));
  respond = async offset => all.slice(offset, offset + 24);
  await render(); await click(header());
  assert.deepEqual(requests.map(request => request.offset), [4, 28]);
  assert.equal(store.getState().byEvent["42"].rows.length, 45);
  assert.match(document.body.textContent ?? "", /45 member profiles shown/);
  await click(button("member-45"));
  assert.deepEqual(navigate, ["member-45"]);
});

test("offline paging shows retry, keeps profiles, and resumes from the same cursor", async () => {
  respond = async () => { throw new Error("offline fixture"); };
  await render(); await click(header());
  assert.equal(requests.length, 1, "no automatic retry loop");
  assert.match(document.body.textContent ?? "", /Couldn't load more member profiles/);
  assert.equal(store.getState().byEvent["42"].rows.length, 4);
  respond = async () => [person(5)];
  await click(button("Try again"));
  assert.deepEqual(requests.map(request => request.offset), [4, 4]);
  assert.match(document.body.textContent ?? "", /5 member profiles shown/);
  assert.equal(button("Try again"), undefined);
});

test("collapse is inert and event navigation never mixes profile lists", async () => {
  await render(); await click(header()); await click(header());
  const panel = document.querySelector('[aria-hidden="true"]');
  assert.ok(panel?.hasAttribute("inert"));
  props = { ...props, id: "43", eventId: "43", attendees: [person(100)], totalCount: 1 };
  await render(); await click(header());
  assert.match(document.body.textContent ?? "", /member-100/);
  assert.doesNotMatch(document.body.textContent ?? "", /member-1(?:\D|$)/);
});

test("realtime privacy revocation and account changes discard a late page", async () => {
  for (const revoke of ["privacy", "account"]) {
    let finish!: (rows: unknown[]) => void;
    respond = () => new Promise(resolve => { finish = resolve; });
    props = { ...props, event: { category: "sex_party", showAttendees: true }, id: revoke, eventId: revoke };
    await render(); await click(header());
    await React.act(async () => {
      if (revoke === "privacy") props = { ...props, event: { category: "sex_party", showAttendees: false } };
      else { session = { epoch: 2, ready: false }; boundary(); props = { ...props, attendees: [], isLoggedIn: false }; }
      root.render(React.createElement(Component, props));
    });
    await React.act(async () => finish([person(99)]));
    assert.doesNotMatch(document.body.textContent ?? "", /member-/);
    assert.equal(store.getState().byEvent[revoke]?.rows.length ?? 0, 0);
    // Start the next scenario with a ready session but not old in-flight work.
    session = { epoch: 3, ready: true };
    props = { ...props, attendees: four, isLoggedIn: true };
  }
});

test("guest-only tickets do not claim the signed-in viewer is not going", async () => {
  props = { ...props, attendees: [] };
  await render();
  assert.match(document.body.textContent ?? "", /45 going/);
  assert.match(document.body.textContent ?? "", /No member profiles available/);
  assert.doesNotMatch(document.body.textContent ?? "", /Only people going/);
  assert.equal(header(), null);
  assert.equal(requests.length, 0);
});
