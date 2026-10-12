import assert from "node:assert/strict";
import { test } from "node:test";
import { readNewMemberProgress } from "./new-member-progress-contract.ts";

const complete = {
  step: "complete", required: false, hasPhoto: true, hasPost: true,
  emailVerified: true, adultVerified: true,
};

test("current server evidence preserves verification, photo, post and completed stages", () => {
  for (const progress of [
    complete,
    { ...complete, step: "pending_verification", required: true, adultVerified: false },
    { ...complete, step: "photo", required: true, hasPhoto: false },
    { ...complete, step: "first_post", required: true, hasPost: false },
  ]) assert.equal(readNewMemberProgress(progress), progress);
});

test("old opt-out responses are unavailable, never invented missing-photo evidence", () => {
  for (const progress of [
    { step: "not_required", required: false },
    { ...complete, step: "not_required" },
    null, undefined, {},
  ]) assert.throws(() => readNewMemberProgress(progress), /temporarily unavailable/);
});

test("missing or nonboolean evidence cannot unlock or trap a member in the wrong step", () => {
  for (const field of ["hasPhoto", "hasPost", "emailVerified", "adultVerified"]) {
    for (const value of [undefined, null, "true", 1]) {
      assert.throws(() => readNewMemberProgress({ ...complete, [field]: value }), /temporarily unavailable/);
    }
  }
});

test("contradictory stage and evidence responses fail closed into retry", () => {
  for (const progress of [
    { ...complete, required: true },
    { ...complete, step: "pending_verification", required: true, hasPhoto: false, hasPost: false },
    { ...complete, hasPhoto: false },
    { ...complete, hasPost: false },
    { ...complete, step: "photo", required: true },
    { ...complete, step: "first_post", required: true },
    { ...complete, step: "first_post", required: true, hasPhoto: false, hasPost: false },
    { ...complete, step: "unknown" },
  ]) assert.throws(() => readNewMemberProgress(progress), /temporarily unavailable/);
});
