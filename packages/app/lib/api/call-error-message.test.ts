import { test } from "node:test";
import assert from "node:assert/strict";
import { callErrorMessage } from "./call-error-message.ts";

test("Lynk copy is reworded for the Calls UI", () => {
  // The one the user actually hit: hang up, reopen the call, and the call
  // screen said "This Lynk's session has ended".
  assert.equal(
    callErrorMessage("This Lynk's session has ended"),
    "This call has ended",
  );
  assert.equal(callErrorMessage("Room is no longer open"), "This call has ended");
  assert.equal(callErrorMessage("Room not found"), "Call not found");
  assert.equal(callErrorMessage("Room is full"), "This call is full");
});

test("no rewrite says 'room' or 'Lynk' to someone on a call", () => {
  const proxied = [
    "This Lynk's session has ended",
    "Room is no longer open",
    "Room not found",
    "Room is full",
    "You are banned from this room",
  ];
  for (const msg of proxied) {
    assert.doesNotMatch(
      callErrorMessage(msg),
      /lynk|room/i,
      `"${msg}" still leaks Lynk vocabulary into the call screen`,
    );
  }
});

test("anything unmapped passes through untouched", () => {
  // Better an unfamiliar server message than a wrong friendly one.
  for (const msg of ["Failed to join room", "No peer token received", ""]) {
    assert.equal(callErrorMessage(msg), msg);
  }
});
