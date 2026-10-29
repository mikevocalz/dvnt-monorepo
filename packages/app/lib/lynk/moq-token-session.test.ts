import { test } from "node:test";
import assert from "node:assert/strict";
import { createMoqTokenSession, MoqTokenRequestError, type MoqTokenState } from "./moq-token-session.ts";

type Token = { expiresAt: string; path: string };
const token = (path = "lynk/room/alice", expiry = 3_600_000): Token => ({ path, expiresAt: new Date(expiry).toISOString() });
function harness(fetchToken: (signal: AbortSignal) => Promise<Token>) {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const states: MoqTokenState<Token>[] = [];
  const session = createMoqTokenSession({
    fetchToken, onChange: (state) => states.push(state), now: () => now,
    schedule: (callback, delay) => { const id = ++nextId; timers.set(id, { callback: () => { timers.delete(id); callback(); }, delay }); return id; },
    cancel: (id) => timers.delete(id),
  });
  return { session, timers, states, advance: (ms: number) => { now += ms; } };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("initial transient mint failure retries and recovers without leaving the room", async () => {
  let calls = 0;
  const h = harness(async () => { if (++calls === 1) throw new Error("offline"); return token(); });
  assert.equal(await h.session.refresh(), null);
  assert.equal(h.states.at(-1)?.error, "offline");
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 1000);
  timer.callback();
  await settle();
  assert.equal(calls, 2);
  assert.equal(h.states.at(-1)?.token?.path, "lynk/room/alice");
  assert.equal(h.states.at(-1)?.error, null);
  assert.deepEqual([...h.timers.values()].map((t) => t.delay).sort(), [3_540_000, 3_600_000]);
  h.session.stop();
});

test("server refusals are terminal and never retain a previously granted token", async () => {
  let denied = false;
  const h = harness(async () => { if (denied) throw new MoqTokenRequestError("banned", false); return token(); });
  await h.session.refresh();
  denied = true;
  await h.session.refresh();
  assert.equal(h.states.at(-1)?.token, null);
  assert.equal(h.states.at(-1)?.error, "banned", "permanent refusal must not be hidden by the old valid grant");
  assert.equal(h.timers.size, 0);
});

test("a stopped room/account cannot deliver its late token or install a timer", async () => {
  let resolve!: (value: Token) => void;
  const h = harness(() => new Promise((r) => { resolve = r; }));
  const pending = h.session.refresh();
  await settle();
  h.session.stop();
  const count = h.states.length;
  resolve(token("lynk/old/account"));
  assert.equal(await pending, null);
  assert.equal(h.states.length, count);
  assert.equal(h.timers.size, 0);
  assert.equal(await h.session.refresh(), null);
});

test("A → B → A cannot revive an old A session", async () => {
  let resolve!: (value: Token) => void;
  const oldA = harness(() => new Promise((r) => { resolve = r; }));
  const pending = oldA.session.refresh();
  await settle();
  oldA.session.stop();
  const newA = harness(async () => token("lynk/new/a"));
  await newA.session.refresh();
  resolve(token("lynk/old/a"));
  assert.equal(await pending, null);
  assert.equal(newA.states.at(-1)?.token?.path, "lynk/new/a");
  newA.session.stop();
});

test("concurrent refreshes share one mint and one scheduled renewal", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return token(); });
  const first = h.session.refresh();
  assert.equal(first, h.session.refresh());
  await first;
  assert.equal(calls, 1);
  assert.equal(h.timers.size, 2, "one renewal and one independent hard expiry");
  h.session.stop();
});

test("transient renewal keeps a valid token, but never an expired bearer", async () => {
  let offline = false;
  const h = harness(async () => { if (offline) throw new Error("offline"); return token(); });
  await h.session.refresh();
  offline = true;
  await h.session.refresh();
  assert.ok(h.states.at(-1)?.token);
  assert.equal(h.states.at(-1)?.error, null, "proactive renewal failure must not replace an active room with an error screen");
  h.advance(3_600_001);
  await h.session.refresh();
  assert.equal(h.states.at(-1)?.token, null);
  h.session.stop();
});

test("retry delay backs off to thirty seconds and cleanup cancels it", async () => {
  const h = harness(async () => { throw new Error("offline"); });
  for (const expected of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    await h.session.refresh();
    assert.equal([...h.timers.values()][0].delay, expected);
  }
  h.session.stop();
  assert.equal(h.timers.size, 0);
});

test("a synchronously thrown mint error does not lock the in-flight guard", async () => {
  let failed = false;
  const h = harness(() => { if (!failed) { failed = true; throw new Error("offline"); } return Promise.resolve(token()); });
  await h.session.refresh();
  assert.ok(await h.session.refresh());
  h.session.stop();
});

test("a 120-second token renews after sixty seconds and expires independently", async () => {
  const h = harness(async () => token("lynk/room/short", 120_000));
  await h.session.refresh();
  assert.deepEqual([...h.timers.values()].map((t) => t.delay).sort((a, b) => a - b), [60_000, 120_000]);
  h.session.stop();
  assert.equal(h.timers.size, 0);
});

test("hard expiry removes media authority even while a renewal promise is hung", async () => {
  let calls = 0;
  let signal!: AbortSignal;
  const h = harness((s) => {
    signal = s;
    return ++calls === 1 ? Promise.resolve(token("lynk/room/short", 120_000)) : new Promise(() => {});
  });
  await h.session.refresh();
  h.advance(60_000);
  const pending = h.session.refresh();
  await settle();
  h.advance(60_000);
  [...h.timers.values()].find((t) => t.delay === 120_000)!.callback();
  assert.equal(h.states.at(-1)?.token, null);
  assert.match(h.states.at(-1)?.error ?? "", /expired/);
  [...h.timers.values()].find((t) => t.delay === 8000)!.callback();
  assert.equal(await pending, null);
  assert.equal(signal.aborted, true);
  h.session.stop();
});

test("retry backoff cannot retain a token beyond its hard expiry", async () => {
  let offline = false;
  const h = harness(async () => { if (offline) throw new Error("offline"); return token("lynk/room/short", 20_000); });
  await h.session.refresh();
  offline = true;
  for (let i = 0; i < 6; i++) await h.session.refresh();
  assert.ok([...h.timers.values()].some((t) => t.delay === 30_000));
  h.advance(20_000);
  [...h.timers.values()].find((t) => t.delay === 20_000)!.callback();
  assert.equal(h.states.at(-1)?.token, null);
  h.session.stop();
});

test("replacement cancels the previous token's hard-expiry callback", async () => {
  let expiry = 120_000;
  const h = harness(async () => token("lynk/room/short", expiry));
  await h.session.refresh();
  const oldExpiry = [...h.timers.values()].find((t) => t.delay === 120_000)!;
  h.advance(60_000);
  expiry = 180_000;
  await h.session.refresh();
  oldExpiry.callback();
  assert.equal(h.states.at(-1)?.token?.expiresAt, new Date(180_000).toISOString());
  assert.equal(h.timers.size, 2);
  h.session.stop();
});
