/**
 * Runs with no platform, no transport, no device, no browser:
 *   node --test packages/app/features/sneaky-lynk/session/machine.test.ts
 * Node strips the types itself (>= 22.6), so this needs no runner and no dep.
 *
 * Every case here is a WS-3 failure mode. If one of them can only be checked by
 * joining a real room on real hardware, it is not production ready.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createSession,
  transition,
  isActive,
  shouldAttemptReconnect,
  reconnectDelayMs,
  TRANSITION_TABLE,
  type LynkSession,
  type LynkSessionEvent,
  type LynkSessionState,
} from "./machine.ts";

const drive = (session: LynkSession, ...events: LynkSessionEvent[]): LynkSession =>
  events.reduce(transition, session);

const joined = () => drive(createSession(), { type: "JOIN" }, { type: "JOIN_GRANTED" });

test("a join that the server grants reaches connected", () => {
  assert.equal(joined().state, "connected");
  assert.equal(joined().endReason, null);
});

test("capacity reached during join ends the session naming capacity", () => {
  const s = drive(createSession(), { type: "JOIN" }, { type: "JOIN_REJECTED", reason: "room_full" });
  assert.equal(s.state, "ended");
  assert.equal(s.endReason, "room_full");
});

test("network drop reconnects rather than ending", () => {
  const s = drive(joined(), { type: "TRANSPORT_LOST" });
  assert.equal(s.state, "reconnecting");
  assert.ok(shouldAttemptReconnect(s));
  assert.ok(isActive(s), "a reconnecting session still holds its membership");
});

test("reconnect budget is spent, then the session ends naming exhaustion", () => {
  let s = drive(createSession(3), { type: "JOIN" }, { type: "JOIN_GRANTED" }, { type: "TRANSPORT_LOST" });
  s = drive(s, { type: "RECONNECT_FAILED" }, { type: "RECONNECT_FAILED" });
  assert.equal(s.state, "reconnecting", "budget not spent yet");
  s = transition(s, { type: "RECONNECT_FAILED" });
  assert.equal(s.state, "ended");
  assert.equal(s.endReason, "reconnect_exhausted");
});

test("a successful reattach refunds the budget", () => {
  let s = drive(joined(), { type: "TRANSPORT_LOST" }, { type: "RECONNECT_FAILED" }, { type: "RECONNECT_FAILED" });
  assert.equal(s.attempt, 2);
  s = transition(s, { type: "RECONNECT_SUCCEEDED" });
  assert.equal(s.state, "connected");
  assert.equal(s.attempt, 0, "a flaky-train session must not exhaust its budget on unrelated blips");
});

test("backoff grows and is capped", () => {
  const at = (attempt: number) => reconnectDelayMs({ ...createSession(), attempt });
  assert.equal(at(0), 500);
  assert.equal(at(1), 1000);
  assert.equal(at(4), 8000);
  assert.equal(at(40), 8000, "capped, not overflowed");
});

test("background then foreground re-establishes instead of pretending to be live", () => {
  const bg = transition(joined(), { type: "BACKGROUNDED" });
  assert.equal(bg.state, "degraded");
  assert.ok(bg.backgrounded);
  const fg = transition(bg, { type: "FOREGROUNDED" });
  assert.equal(fg.state, "reconnecting");
});

test("host ending the room is terminal and outranks a pending reconnect", () => {
  const s = drive(joined(), { type: "TRANSPORT_LOST" }, { type: "HOST_ENDED" });
  assert.equal(s.state, "ended");
  assert.equal(s.endReason, "host_ended");
  assert.equal(transition(s, { type: "RECONNECT_SUCCEEDED" }).state, "ended", "ended is terminal");
});

test("entitlement expiring mid-session ends it, and says so", () => {
  const s = transition(joined(), { type: "ENTITLEMENT_EXPIRED" });
  assert.equal(s.state, "ended");
  assert.equal(s.endReason, "entitlement_expired");
});

test("permission revoked mid-room ends it, and says so", () => {
  const s = transition(joined(), { type: "PERMISSION_REVOKED" });
  assert.equal(s.state, "ended");
  assert.equal(s.endReason, "permission_revoked");
});

test("leaving names 'left', not a failure", () => {
  assert.equal(transition(joined(), { type: "LEAVE" }).endReason, "left");
});

test("duplicate and late transport events are inert", () => {
  const s = joined();
  assert.deepEqual(transition(s, { type: "JOIN_GRANTED" }), s);
  assert.deepEqual(transition(s, { type: "RECONNECT_SUCCEEDED" }), s);
  assert.deepEqual(transition(createSession(), { type: "TRANSPORT_LOST" }), createSession());
});

test("every terminal path names a reason", () => {
  const terminal: LynkSessionEvent[] = [
    { type: "HOST_ENDED" },
    { type: "KICKED" },
    { type: "ENTITLEMENT_EXPIRED" },
    { type: "PERMISSION_REVOKED" },
    { type: "LEAVE" },
    { type: "JOIN_REJECTED", reason: "entitlement_denied" },
  ];
  for (const event of terminal) {
    const s = transition(drive(createSession(), { type: "JOIN" }), event);
    assert.equal(s.state, "ended", `${event.type} should end the session`);
    assert.ok(s.endReason, `${event.type} ended with no reason`);
  }
});

test("the table is exhaustive over states, and only 'ended' is terminal", () => {
  const states: LynkSessionState[] = ["idle", "joining", "connected", "degraded", "reconnecting", "ended"];
  for (const state of states) {
    assert.ok(state in TRANSITION_TABLE, `no row for ${state}`);
  }
  const dead = states.filter((s) => Object.keys(TRANSITION_TABLE[s]).length === 0);
  assert.deepEqual(dead, ["ended"], "exactly one terminal state");
  const reachable = new Set<string>(
    states.flatMap((s) => Object.values(TRANSITION_TABLE[s]) as string[]),
  );
  for (const state of states) {
    if (state === "idle") continue;
    assert.ok(reachable.has(state), `${state} is unreachable — dead state in the table`);
  }
});

test("every state except idle can be left for 'ended' — no state can strand a user in a room", () => {
  const states: LynkSessionState[] = ["joining", "connected", "degraded", "reconnecting"];
  for (const state of states) {
    const s: LynkSession = { ...createSession(), state };
    assert.equal(transition(s, { type: "LEAVE" }).state, "ended", `${state} cannot be left`);
  }
});

// ── Recovery policy the adapter acts on ──────────────────────────────────────

test("a drop schedules attempts at growing delays, then gives up", () => {
  let s = drive(createSession(3), { type: "JOIN" }, { type: "JOIN_GRANTED" }, { type: "TRANSPORT_LOST" });
  const delays: number[] = [];
  while (shouldAttemptReconnect(s)) {
    delays.push(reconnectDelayMs(s));
    s = transition(s, { type: "RECONNECT_FAILED" });
  }
  assert.deepEqual(delays, [500, 1000, 2000], "backoff must grow between attempts");
  assert.equal(s.state, "ended");
  assert.equal(s.endReason, "reconnect_exhausted");
});

test("a room that ended is never retried", () => {
  const s = drive(joined(), { type: "TRANSPORT_LOST" }, { type: "HOST_ENDED" });
  assert.equal(shouldAttemptReconnect(s), false, "retrying a closed room hammers the relay for nothing");
});

test("leaving mid-reconnect stops the retry loop", () => {
  const s = drive(joined(), { type: "TRANSPORT_LOST" }, { type: "LEAVE" });
  assert.equal(shouldAttemptReconnect(s), false);
  assert.equal(s.endReason, "left");
});
