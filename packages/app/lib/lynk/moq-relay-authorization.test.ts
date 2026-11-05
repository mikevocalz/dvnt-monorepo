import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelayAuthorization, type RelayGrant } from "./moq-relay-authorization.ts";
import { createMoqTokenSession, MoqTokenRequestError } from "./moq-token-session.ts";

class Signal<T> {
  listeners = new Set<() => void>();
  value: T;
  constructor(value: T) { this.value = value; }
  peek() { return this.value; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  set(value: T) { this.value = value; for (const fn of [...this.listeners]) fn(); }
}
const grant = (version = 1, overrides: Partial<RelayGrant> = {}): RelayGrant => ({
  relayUrl: `https://relay.example.invalid/app?jwt=credential-${version}&region=us`,
  expiresAt: new Date(120_000 + (version - 1) * 60_000).toISOString(),
  intent: "subscribe", fishjamId: "app", namespace: "lynk/room", path: "lynk/room",
  peerId: "alice", role: "participant", ...overrides,
});
function fixture() {
  let now = 0;
  const status = new Signal("connected"), error = new Signal<Error | undefined>(undefined);
  const changes: (string | undefined)[] = [];
  const auth = createRelayAuthorization({ status, error, now: () => now, setUrl: url => changes.push(url?.href) });
  return { auth, status, error, changes, advance: (ms: number) => { now += ms; } };
}

test("ten minutes of fresh equivalent authorization never redials a healthy wire", () => {
  const h = fixture();
  h.auth.authorize(grant(), "room/alice/epoch1");
  for (let i = 2; i <= 11; i++) {
    h.advance(60_000);
    h.auth.authorize(grant(i), "room/alice/epoch1");
  }
  assert.deepEqual(h.changes, [grant().relayUrl]);
  h.status.set("disconnected");
  assert.equal(h.changes.at(-1), grant(11).relayUrl, "actual drop receives newest, not initial credentials");
  h.status.set("connecting"); h.status.set("disconnected"); h.error.set(new Error("offline"));
  assert.equal(h.changes.length, 2, "same credentials cannot reset retry backoff");
  h.auth.close();
});

for (const [field, value] of Object.entries({ intent: "publish", fishjamId: "other", namespace: "lynk/other", path: "lynk/room/bob", peerId: "bob", role: "listener", relayUrl: "https://other.example.invalid/app?jwt=credential-2" })) {
  test(`changed ${field} replaces the old authorization even while connected`, () => {
    const h = fixture();
    h.auth.authorize(grant(), "owner");
    h.auth.authorize(grant(2, { [field]: value }), "owner");
    // Scope-only changes with the same URL are deliberately idempotent: an
    // actual minted replacement has a different JWT, as this fixture does.
    assert.equal(h.changes.length, 2);
    h.auth.close();
  });
}
for (const [label, url] of [
  ["port", "https://relay.example.invalid:8443/app?jwt=new&region=us"],
  ["path", "https://relay.example.invalid/other?jwt=new&region=us"],
  ["non-JWT query option", "https://relay.example.invalid/app?jwt=new&region=eu"],
  ["unknown credential parameter", "https://relay.example.invalid/app?jwt=new&region=us&token=other"],
]) {
  test(`relay ${label} changes cannot be mistaken for JWT renewal`, () => {
    const h = fixture(); h.auth.authorize(grant(), "owner");
    h.auth.authorize(grant(2, { relayUrl: url }), "owner");
    assert.equal(h.changes.at(-1), url); assert.equal(h.changes.length, 2); h.auth.close();
  });
}

test("room/account epochs are independent even if public peer identity is reused", () => {
  const h = fixture(); h.auth.authorize(grant(), "room/A/1");
  h.auth.authorize(grant(2), "room/B/1"); h.auth.authorize(grant(3), "room/A/2");
  assert.equal(h.changes.length, 3); h.auth.close();
});

test("same URL under changed authority fails closed instead of relabeling a live wire", () => {
  const h = fixture(); h.auth.authorize(grant(), "room/A/1");
  h.auth.authorize(grant(), "room/B/1");
  assert.equal(h.changes.at(-1), undefined);
  h.status.set("disconnected"); h.auth.authorize(grant(), "room/B/1");
  assert.equal(h.changes.at(-1), undefined, "repeated callback cannot reinstall refused credentials");
  h.auth.authorize(grant(2), "room/B/1");
  assert.equal(h.changes.at(-1), grant(2).relayUrl); h.auth.close();
});

test("terminal SDK error uses the freshest grant without waiting for React", () => {
  const h = fixture(); h.auth.authorize(grant(), "owner"); h.auth.authorize(grant(2), "owner");
  h.error.set(new Error("Unauthorized: original-wire token expired"));
  assert.equal(h.changes.at(-1), grant(2).relayUrl);
  h.error.set(new Error("Unauthorized")); assert.equal(h.changes.length, 2); h.auth.close();
});

test("missing, malformed and expired grants clear the connection, including delayed background timers", () => {
  for (const invalid of [null, grant(2, { expiresAt: "invalid" }), grant(2, { expiresAt: new Date(0).toISOString() }), grant(2, { relayUrl: "invalid" })]) {
    const h = fixture(); h.auth.authorize(grant(), "owner"); h.auth.authorize(invalid, "owner");
    assert.equal(h.changes.at(-1), undefined); h.auth.close();
  }
  const h = fixture(); h.auth.authorize(grant(), "owner"); h.advance(120_000);
  h.status.set("connecting");
  assert.equal(h.changes.at(-1), undefined, "resume cannot reconnect expired authority before its delayed timeout fires");
  h.auth.close();
});

test("denial and leave cannot be undone by late transport notifications", () => {
  const h = fixture(); h.auth.authorize(grant(), "owner"); h.auth.authorize(null, "owner");
  h.status.set("connected"); h.error.set(new Error("late"));
  assert.deepEqual(h.changes, [grant().relayUrl, undefined]);
  h.auth.close(); h.auth.authorize(grant(2), "owner"); h.status.set("disconnected");
  assert.equal(h.changes.at(-1), undefined); assert.equal(h.status.listeners.size, 0); assert.equal(h.error.listeners.size, 0);
});

test("actual token session keeps bounded renewal failure quiet, then hard-expiry closes the wire", async () => {
  const h = fixture(); let now = 0, failure = false;
  const timers = new Set<{ callback: () => void; delay: number }>();
  const session = createMoqTokenSession({
    fetchToken: async () => { if (failure) throw new Error("edge unavailable"); return grant(); },
    onChange: state => h.auth.authorize(state.token, "owner"), now: () => now,
    schedule: (callback, delay) => { const timer = { callback, delay }; timers.add(timer); return timer; },
    cancel: timer => timers.delete(timer),
  });
  await session.refresh(); failure = true; now = 60_000; h.advance(60_000);
  await session.refresh(); assert.deepEqual(h.changes, [grant().relayUrl]);
  now = 120_000; h.advance(60_000);
  [...timers].find(timer => timer.delay === 120_000)!.callback();
  assert.equal(h.changes.at(-1), undefined); session.stop(); h.auth.close();
});

test("actual token-session business refusal immediately removes a still-valid grant", async () => {
  const h = fixture(); let denied = false;
  const timers = new Set<() => void>();
  const session = createMoqTokenSession({
    fetchToken: async () => { if (denied) throw new MoqTokenRequestError("room membership ended", false); return grant(); },
    onChange: state => h.auth.authorize(state.token, "owner"), now: () => 0,
    schedule: callback => { timers.add(callback); return callback; }, cancel: timer => timers.delete(timer),
  });
  await session.refresh(); denied = true; await session.refresh();
  assert.equal(h.changes.at(-1), undefined); assert.equal(timers.size, 0); session.stop(); h.auth.close();
});
