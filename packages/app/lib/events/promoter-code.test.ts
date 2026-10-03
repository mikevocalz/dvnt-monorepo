import test from "node:test";
import assert from "node:assert/strict";
import { normalizePromoterCodeInput, promoterCodeFieldError } from "./promoter-code.ts";

test("the code input keeps the case the host typed", () => {
  assert.equal(normalizePromoterCodeInput("Tre151Share"), "Tre151Share");
  assert.equal(normalizePromoterCodeInput("tre 151!share"), "tre151share");
  assert.equal(normalizePromoterCodeInput("a_b-C"), "a_b-C");
  assert.equal(normalizePromoterCodeInput("x".repeat(40)).length, 32);
});

test("a 409 duplicate code is shown inline under the field", () => {
  assert.equal(
    promoterCodeFieldError({ status: 409, message: "That code is already in use for this event" }),
    "That code is already in use for this event",
  );
  assert.equal(
    promoterCodeFieldError({ status: 400, message: "Code must be 2–32 letters, numbers, - or _" }),
    "Code must be 2–32 letters, numbers, - or _",
  );
});

test("failures that are not about the code stay out of the field", () => {
  assert.equal(promoterCodeFieldError({ status: 409, message: "This user is already a promoter for this event" }), null);
  assert.equal(promoterCodeFieldError({ status: 500, message: "Could not add promoter" }), null);
  assert.equal(promoterCodeFieldError(null), null);
});

test("an invalid invite email shows under the email field, not the code field", async () => {
  const { promoterInviteEmailFieldError } = await import("./promoter-code.ts");
  const err = { status: 400, message: "Enter a valid email address" };
  assert.equal(promoterInviteEmailFieldError(err), "Enter a valid email address");
  assert.equal(promoterCodeFieldError(err), null);
  assert.equal(promoterInviteEmailFieldError({ status: 429, message: "Too many invite emails." }), null);
  assert.equal(promoterInviteEmailFieldError({ status: 409, message: "That code is already in use for this event" }), null);
});

test("the add toast says whether the invite email went out", async () => {
  const { promoterAddedDescription } = await import("./promoter-code.ts");
  assert.match(promoterAddedDescription("DOOR1", "sent"), /emailed/);
  assert.match(promoterAddedDescription("DOOR1", "failed"), /didn't go out/);
  assert.doesNotMatch(promoterAddedDescription("DOOR1", "no_account"), /email/);
});
