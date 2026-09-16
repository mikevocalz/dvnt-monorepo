/** node --test packages/app/features/call/incoming-call-lifecycle.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_INCOMING_CALL,
  reduceIncomingCall,
  type IncomingCallState,
} from "./incoming-call-lifecycle.ts";

const ring = (id: string, callPhase = "idle") =>
  ({
    type: "ring",
    signal: { id },
    viewerId: "viewer-1",
    accountGen: "gen-1",
    callPhase,
  }) as const;

const ringing = (id = "call-1"): IncomingCallState =>
  reduceIncomingCall(EMPTY_INCOMING_CALL, ring(id));

test("a ring while idle presents; a ring mid-call never covers the call", () => {
  assert.equal(ringing().call?.id, "call-1");
  for (const busy of ["joining_room", "connecting_peer", "connected"]) {
    assert.equal(reduceIncomingCall(EMPTY_INCOMING_CALL, ring("x", busy)).call, null);
  }
  // Ending one call leaves you answerable for the next.
  assert.equal(reduceIncomingCall(EMPTY_INCOMING_CALL, ring("y", "call_ended")).call?.id, "y");
});

test("every way a call can end clears the overlay", () => {
  const ends = [
    { type: "signal_ended", id: "call-1" }, // caller hung up
    { type: "timeout", id: "call-1" }, // nobody answered
    { type: "answered" },
    { type: "declined" },
    { type: "call_phase", callPhase: "connected" }, // answered elsewhere
    { type: "call_phase", callPhase: "call_ended" }, // the call is over
    { type: "call_phase", callPhase: "error" },
    { type: "account_changed", viewerId: "viewer-2", accountGen: "gen-2" },
  ] as const;
  for (const event of ends) {
    assert.equal(
      reduceIncomingCall(ringing(), event).call,
      null,
      `${event.type} left the overlay on screen`,
    );
  }
});

test("a stale timer cannot cancel the call ringing now", () => {
  const now = ringing("call-2");
  assert.equal(reduceIncomingCall(now, { type: "timeout", id: "call-1" }).call?.id, "call-2");
  assert.equal(reduceIncomingCall(now, { type: "signal_ended", id: "call-1" }).call?.id, "call-2");
});

test("the overlay survives an idle phase tick and the same account re-reporting", () => {
  const now = ringing();
  assert.equal(reduceIncomingCall(now, { type: "call_phase", callPhase: "idle" }), now);
  assert.equal(
    reduceIncomingCall(now, {
      type: "account_changed",
      viewerId: "viewer-1",
      accountGen: "gen-1",
    }),
    now,
  );
});
