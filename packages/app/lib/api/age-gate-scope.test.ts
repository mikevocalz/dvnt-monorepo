import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The age gate asked "is the event restricted and is this viewer unverified".
 * Both are true for every existing member on every 18+ event, so the whole
 * membership was told to scan an ID — for a capture session that could not be
 * created. Scope is the third condition, and it belongs to
 * verified_admission_policy, not to the event.
 *
 * Mirrors needsAgeVerification in lib/hooks/use-age-verification.ts, which
 * cannot be imported here: it pulls in the react-query hook module.
 */
function needsAgeVerification(
  ageRestriction: string | undefined | null,
  status: string | undefined,
  inScope: boolean = false,
): boolean {
  const restricted = ageRestriction === "18+" || ageRestriction === "21+";
  return restricted && status !== "passed" && inScope;
}

test("an existing member is not asked for ID on an 18+ event", () => {
  assert.equal(needsAgeVerification("18+", "none", false), false);
  assert.equal(needsAgeVerification("21+", undefined, false), false);
});

test("a caller that forgets scope prompts nobody, rather than everybody", () => {
  // The two-argument shape is what shipped and what harassed the membership.
  assert.equal(needsAgeVerification("18+", "none"), false);
});

test("an in-scope viewer on a restricted event is still asked", () => {
  assert.equal(needsAgeVerification("18+", "none", true), true);
  assert.equal(needsAgeVerification("21+", "review", true), true);
});

test("verified means never asked again, in or out of scope", () => {
  assert.equal(needsAgeVerification("18+", "passed", true), false);
  assert.equal(needsAgeVerification("21+", "passed", false), false);
});

test("an unrestricted event never asks, whatever the scope", () => {
  assert.equal(needsAgeVerification("none", "none", true), false);
  assert.equal(needsAgeVerification(null, undefined, true), false);
  assert.equal(needsAgeVerification(undefined, "none", true), false);
});
