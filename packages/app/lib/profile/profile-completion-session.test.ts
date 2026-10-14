import assert from "node:assert/strict";
import { test } from "node:test";
import { createProfileCompletionSession } from "./profile-completion-session.ts";
import type { NewMemberProgress } from "./new-member-progress.ts";

const complete: NewMemberProgress = { step: "complete", required: false, hasPhoto: true, hasPost: true, emailVerified: true, adultVerified: true };
const photo: NewMemberProgress = { ...complete, step: "photo", required: true, hasPhoto: false };
const firstPost: NewMemberProgress = { ...complete, step: "first_post", required: true, hasPost: false };
const a = { memberId: "a", epoch: 1 };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function harness() {
  const requests: { resolve: (value: NewMemberProgress) => void; reject: (error: Error) => void }[] = [];
  const store = createProfileCompletionSession(() => new Promise((resolve, reject) => requests.push({ resolve, reject })));
  return { store, requests };
}

test("unknown session is fail-closed and deduplicates mounted hosts", async () => {
  const { store, requests } = harness();
  store.ensure(); await flush(); assert.equal(requests.length, 0);
  store.setSession(a); store.ensure(); store.ensure(); await flush();
  assert.equal(requests.length, 1); assert.equal(store.getSnapshot().status, "pending");
  requests[0].resolve(complete); await flush(); assert.equal(store.getSnapshot().status, "ready");
});

test("confirmed evidence survives host unmount, remount and ordinary ensure calls", async () => {
  const { store, requests } = harness();
  const unsubscribe = store.subscribe(() => {});
  store.setSession(a); store.ensure(); await flush(); requests[0].resolve(complete); await flush();
  const confirmed = store.getSnapshot(); unsubscribe();
  for (let i = 0; i < 20; i++) { store.setSession({ ...a }); store.ensure(); }
  const unsubscribeAgain = store.subscribe(() => {}); await flush();
  assert.equal(store.getSnapshot(), confirmed); assert.equal(requests.length, 1); unsubscribeAgain();
});

test("same member in a new signed session never inherits completion", async () => {
  const { store, requests } = harness();
  store.setSession(a); store.ensure(); await flush(); requests[0].resolve(complete); await flush();
  store.setSession({ ...a, epoch: 2 }); store.ensure(); await flush();
  assert.equal(store.getSnapshot().status, "pending"); assert.equal(requests.length, 2);
  requests[1].resolve(photo); await flush(); assert.deepEqual(store.getSnapshot(), { session: { ...a, epoch: 2 }, status: "ready", progress: photo });
});

test("logout while no host is subscribed rejects late success and failure", async () => {
  for (const fails of [false, true]) {
    const { store, requests } = harness();
    store.setSession(a); store.ensure(); await flush();
    store.setSession(null);
    if (fails) requests[0].reject(new Error("old session")); else requests[0].resolve(complete);
    await flush(); assert.deepEqual(store.getSnapshot(), { session: null, status: "pending" });
    store.setSession({ ...a, epoch: 3 }); store.ensure(); await flush(); assert.equal(requests.length, 2);
    assert.equal(store.getSnapshot().status, "pending");
  }
});

test("account switch rejects old results and server-incomplete new member is gated", async () => {
  const { store, requests } = harness();
  store.setSession(a); store.ensure(); await flush();
  const b = { memberId: "b", epoch: 2 }; store.setSession(b); store.ensure(); await flush();
  requests[0].resolve(complete); await flush(); assert.equal(store.getSnapshot().status, "pending");
  requests[1].resolve(photo); await flush(); assert.deepEqual(store.getSnapshot(), { session: b, status: "ready", progress: photo });
});

test("confirmed first-post deletion or photo removal requires fresh authoritative evidence", async () => {
  for (const incomplete of [firstPost, photo]) {
    const { store, requests } = harness();
    store.setSession(a); store.ensure(); await flush(); requests[0].resolve(complete); await flush();
    store.invalidate("other-member"); await flush(); assert.equal(requests.length, 1);
    store.invalidate("a"); await flush(); assert.equal(store.getSnapshot().status, "pending");
    requests[1].resolve(incomplete); await flush();
    assert.deepEqual(store.getSnapshot(), { session: a, status: "ready", progress: incomplete });
  }
});

test("rapid confirmed mutations reject stale complete and failed reads", async () => {
  const { store, requests } = harness();
  store.setSession(a); store.ensure(); await flush();
  store.invalidate("a"); await flush(); store.invalidate("a"); await flush();
  requests[2].resolve(firstPost); await flush();
  requests[0].resolve(complete); requests[1].reject(new Error("old request")); await flush();
  assert.deepEqual(store.getSnapshot(), { session: a, status: "ready", progress: firstPost });
});

test("failed checks remain blocking across remounts, with only explicit retry", async () => {
  const { store, requests } = harness();
  store.setSession(a); store.ensure(); await flush(); requests[0].reject(new Error("offline")); await flush();
  for (let i = 0; i < 10; i++) store.ensure(); await flush();
  assert.equal(requests.length, 1); assert.equal(store.getSnapshot().status, "error");
  store.retry(); await flush(); assert.equal(store.getSnapshot().status, "pending");
  requests[1].resolve(complete); await flush(); assert.equal(store.getSnapshot().status, "ready");
});

test("a synchronous transport error is also fail-closed", async () => {
  const store = createProfileCompletionSession(() => { throw new Error("transport init"); });
  store.setSession(a); store.ensure(); await flush(); assert.equal(store.getSnapshot().status, "error");
});

test("background freshness checks keep proof while pending and gate external deletion", async () => {
  const { store, requests } = harness();
  store.setSession(a); store.ensure(); await flush(); requests[0].resolve(complete); await flush();
  const confirmed = store.getSnapshot();
  store.revalidate(); store.revalidate(); await flush();
  assert.equal(requests.length, 2); assert.equal(store.getSnapshot(), confirmed);
  requests[1].resolve(firstPost); await flush();
  assert.deepEqual(store.getSnapshot(), { session: a, status: "ready", progress: firstPost });
});

test("background read failure closes the gate and cannot retry-loop on focus", async () => {
  const { store, requests } = harness();
  store.setSession(a); store.ensure(); await flush(); requests[0].resolve(complete); await flush();
  store.revalidate(); await flush(); requests[1].reject(new Error("revoked or unavailable")); await flush();
  assert.equal(store.getSnapshot().status, "error");
  store.revalidate(); store.ensure(); await flush(); assert.equal(requests.length, 2);
});

test("verification completion rechecks pending_verification and exposes required steps", async () => {
  const { store, requests } = harness();
  store.setSession(a); store.ensure(); await flush();
  requests[0].resolve({ ...photo, step: "pending_verification", adultVerified: false }); await flush();
  store.invalidate("a"); await flush(); requests[1].resolve(photo); await flush();
  assert.deepEqual(store.getSnapshot(), { session: a, status: "ready", progress: photo });
});
