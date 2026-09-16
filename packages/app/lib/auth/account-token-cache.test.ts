import test from "node:test";
import assert from "node:assert/strict";
import { createAccountTokenCache, withAccountTokenInvalidation, type TokenIdentity } from "./account-token-cache.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const session = (id: string, token = `token-${id}`, expiresAt?: string) => ({
  data: { user: { id, email: `${id}@example.com` }, session: { token, expiresAt } },
});
function harness(options: { retryDelayMs?: number } = {}) {
  let user: TokenIdentity | null = { id: "a" };
  const requests: ReturnType<typeof deferred<ReturnType<typeof session> | { error: string }>>[] = [];
  const cache = createAccountTokenCache({
    getIdentity: () => user,
    getSession: () => { const request = deferred<ReturnType<typeof session> | { error: string }>(); requests.push(request); return request.promise; },
    ...options,
  });
  return {
    cache, requests,
    setUser(value: TokenIdentity | null) { user = value; cache.observeIdentity(); },
  };
}

test("concurrent API requests share a fetch and cache only the active account", async () => {
  const h = harness();
  const first = h.cache.getToken();
  const second = h.cache.getToken();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(session("a"));
  assert.deepEqual(await Promise.all([first, second]), ["token-a", "token-a"]);
  assert.equal(await h.cache.getToken(), "token-a");
  h.setUser({ id: "b" });
  const next = h.cache.getToken();
  h.requests[1].resolve(session("b"));
  assert.equal(await next, "token-b");
});

test("late old-account results neither refill cache nor erase the new flight", async () => {
  const h = harness();
  const old = h.cache.getToken();
  h.setUser({ id: "b" });
  const current = h.cache.getToken();
  h.requests[0].resolve(session("a"));
  assert.equal(await old, null);
  const shared = h.cache.getToken();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(session("b"));
  assert.deepEqual(await Promise.all([current, shared]), ["token-b", "token-b"]);
});

test("A to B to A and explicit invalidation reject outstanding promises", async () => {
  const h = harness();
  const old = h.cache.getToken();
  h.setUser({ id: "b" }); h.setUser({ id: "a" });
  h.requests[0].resolve(session("a"));
  assert.equal(await old, null);
  const invalidated = h.cache.getToken();
  h.cache.invalidate();
  h.requests[1].resolve(session("a"));
  assert.equal(await invalidated, null);
});

test("wrong session owner is rejected, including profiles with integer IDs", async () => {
  const h = harness();
  const wrong = h.cache.getToken(); h.requests[0].resolve(session("b"));
  assert.equal(await wrong, null);
  h.setUser({ id: "17", authId: "a", email: "a@example.com" });
  const byId = h.cache.getToken(); h.requests[1].resolve(session("b"));
  assert.equal(await byId, null);
  h.setUser({ id: "17", email: "a@example.com" });
  const byEmail = h.cache.getToken(); h.requests[2].resolve(session("b"));
  assert.equal(await byEmail, null);
  const valid = h.cache.getToken(); h.requests[3].resolve(session("a"));
  assert.equal(await valid, "token-a");
});

test("sign-in invalidates old token before profile sync and permits only the new identity", async () => {
  const h = harness();
  const first = h.cache.getToken(); h.requests[0].resolve(session("a")); await first;
  const login = deferred<ReturnType<typeof session>>();
  const client = withAccountTokenInvalidation({ signIn: { email: () => login.promise } }, h.cache);
  const result = client.signIn.email();
  assert.equal(await h.cache.getToken(), null);
  login.resolve(session("b")); await result;
  // Store still displays A while syncAuthUser runs, but a stale A cookie must fail.
  const stale = h.cache.getToken(); h.requests[1].resolve(session("a"));
  assert.equal(await stale, null);
  const bootstrap = h.cache.getToken(); h.requests[2].resolve(session("b"));
  assert.equal(await bootstrap, "token-b");
  h.setUser({ id: "28", authId: "b" });
  const current = h.cache.getToken(); h.requests[3].resolve(session("b"));
  assert.equal(await current, "token-b");
});

test("failed sign-out stays locally blocked even if the server cookie survives", async () => {
  const h = harness();
  const old = h.cache.getToken();
  const client = withAccountTokenInvalidation({ signOut: async () => { throw Error("offline"); } }, h.cache);
  await assert.rejects(client.signOut(), /offline/);
  h.requests[0].resolve(session("a"));
  assert.equal(await old, null);
  assert.equal(await h.cache.getToken(), null);
  assert.equal(h.requests.length, 1);
});

test("an older login cannot unlock a later sign-out", async () => {
  const h = harness();
  const login = deferred<ReturnType<typeof session>>();
  const pending = h.cache.mutate("signIn", () => login.promise);
  await h.cache.mutate("signOut", async () => ({}));
  login.resolve(session("b")); await pending;
  assert.equal(await h.cache.getToken(), null);
});

test("external callback restores auth after successful sign-out and magic-link initiation", async () => {
  const h = harness();
  const old = h.cache.getToken(); h.requests[0].resolve(session("a")); await old;
  await h.cache.mutate("signOut", async () => ({ data: { success: true } }));
  h.setUser(null);
  await h.cache.mutate("signIn", async () => ({ data: { status: true } }));
  assert.equal(await h.cache.getToken(), null);
  const callback = h.cache.resumeSession();
  h.requests[1].resolve(session("b"));
  assert.equal(await callback, true);
  const token = h.cache.getToken(); h.requests[2].resolve(session("b"));
  assert.equal(await token, "token-b");
});

test("failed sign-out callback rejects surviving cookie but accepts a newly issued session", async () => {
  const h = harness();
  const old = h.cache.getToken(); h.requests[0].resolve(session("a")); await old;
  await assert.rejects(h.cache.mutate("signOut", async () => { throw Error("offline"); }));
  const staleCallback = h.cache.resumeSession();
  h.requests[1].resolve(session("a"));
  assert.equal(await staleCallback, false);
  assert.equal(await h.cache.getToken(), null);
  const freshCallback = h.cache.resumeSession();
  h.requests[2].resolve(session("a", "new-sign-in-session"));
  assert.equal(await freshCallback, true);
});

test("callback started before sign-out cannot unlock the later sign-out", async () => {
  const h = harness();
  const callback = h.cache.resumeSession();
  await h.cache.mutate("signOut", async () => ({}));
  h.requests[0].resolve(session("a"));
  assert.equal(await callback, false);
  assert.equal(await h.cache.getToken(), null);
});

test("a retry does not execute after identity invalidation", async () => {
  const h = harness({ retryDelayMs: 5 });
  const pending = h.cache.getToken();
  h.requests[0].resolve({ error: "cold start" });
  await Promise.resolve();
  h.setUser({ id: "b" });
  assert.equal(await pending, null);
  assert.equal(h.requests.length, 1);
});

test("token cache never outlives server expiry", async () => {
  let clock = Date.parse("2026-09-16T12:00:00Z");
  let calls = 0;
  const cache = createAccountTokenCache({
    getIdentity: () => ({ id: "a" }), now: () => clock,
    getSession: async () => { calls += 1; return session("a", `token-${calls}`, new Date(clock + 60_000).toISOString()); },
  });
  assert.equal(await cache.getToken(), "token-1");
  clock += 20_000;
  assert.equal(await cache.getToken(), "token-1");
  clock += 11_000;
  assert.equal(await cache.getToken(), "token-2");
});
