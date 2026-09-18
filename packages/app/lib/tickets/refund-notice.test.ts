import test from "node:test";
import assert from "node:assert/strict";
import {
  REFUND_DOOR_NOTE,
  REFUND_REASON,
  REFUND_TIMING,
  REFUND_TITLE,
} from "./refund-notice.ts";

// The door list and the holder's pass both render these. They used to say
// different things — staff read "Refunded", the guest's own screen read
// "Revoked" — which is the worst place for the app to contradict itself,
// because the guest is holding the phone that disagrees.
test("staff and holder are told the same thing", () => {
  for (const s of [REFUND_REASON, REFUND_TIMING, REFUND_TITLE, REFUND_DOOR_NOTE])
    assert.ok(s.trim().length > 0);
  assert.match(REFUND_TITLE.toLowerCase(), /refund/);
  assert.match(REFUND_DOOR_NOTE.toLowerCase(), /refund/);
  // "Revoked" implies the holder did something wrong. Neither line may use it.
  for (const s of [REFUND_TITLE, REFUND_DOOR_NOTE, REFUND_REASON])
    assert.doesNotMatch(s.toLowerCase(), /revoke/);
});

test("the holder is told when the money lands, not just that it was sent", () => {
  // Absent this, a holder checks their bank, sees nothing, and opens a ticket.
  assert.match(REFUND_TIMING, /\d+.*days/);
  assert.match(REFUND_TIMING.toLowerCase(), /original payment method/);
});
