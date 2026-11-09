import test from "node:test";
import assert from "node:assert/strict";
import {
  canSubmitCompCancellation,
  COMP_CANCEL_WARNING,
  compCancelHolder,
} from "./organizer-comp-cancel.ts";
const ticket = {
  id: "ticket",
  event_id: 80,
  user_id: "original",
  organizer_free_cancel: { eligible: true, reason: null },
};
test("only explicit server eligibility for the current event enables confirmation", () => {
  assert.equal(canSubmitCompCancellation(ticket, 80, "Wrong city"), true);
  assert.equal(canSubmitCompCancellation(ticket, 81, "Wrong city"), false);
  assert.equal(
    canSubmitCompCancellation(
      { ...ticket, organizer_free_cancel: undefined },
      80,
      "Wrong city",
    ),
    false,
  );
  assert.equal(
    canSubmitCompCancellation(
      {
        ...ticket,
        organizer_free_cancel: { eligible: false, reason: "Transferred" },
      },
      80,
      "Wrong city",
    ),
    false,
  );
  assert.equal(
    canSubmitCompCancellation({ ...ticket, user_id: "" }, 80, "Wrong city"),
    false,
  );
});
test("requires bounded meaningful audit reason", () => {
  for (const reason of ["", "    ", "oops", "x".repeat(241)])
    assert.equal(canSubmitCompCancellation(ticket, 80, reason), false);
});
test("confirmation tells truth about offline scanning and no replacement or messages", () => {
  assert.match(
    COMP_CANCEL_WARNING,
    /Offline scanners must reconnect and refresh/,
  );
  assert.match(
    COMP_CANCEL_WARNING,
    /No refund, replacement ticket, or recipient message/,
  );
  assert.equal(compCancelHolder({ ...ticket, username: "guest" }), "@guest");
});

test("account confirmation never substitutes a free-form attendee label", () => {
  assert.equal(compCancelHolder({ ...ticket, holder_name: "Someone else" }), "Account original");
});

test('untiered General admission uses the same explicit server eligibility and confirmation', () => {
  const general = { ...ticket, ticket_type_id: null, ticket_type_name: 'General' };
  assert.equal(canSubmitCompCancellation(general, 80, 'Wrong event'), true);
  assert.equal(canSubmitCompCancellation({ ...general, organizer_free_cancel: { eligible: false, reason: 'Unverified order' } }, 80, 'Wrong event'), false);
  assert.equal(canSubmitCompCancellation(general, 81, 'Wrong event'), false);
});
