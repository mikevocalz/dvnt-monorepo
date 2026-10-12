import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INITIAL_PROFILE_COMPLETION_CHECK,
  profileCompletionCheckReducer as reduce,
  readProfileCompletionCheck as read,
  type ProfileCompletionScope,
} from "./profile-completion-check.ts";
import type { NewMemberProgress } from "./new-member-progress.ts";

const memberA: ProfileCompletionScope = { memberId: "member-a", pathname: "/feed", reload: 0 };
const memberB: ProfileCompletionScope = { ...memberA, memberId: "member-b" };
const complete: NewMemberProgress = {
  step: "complete", required: false, hasPhoto: true, hasPost: true,
  emailVerified: true, adultVerified: true,
};
const photo: NewMemberProgress = { ...complete, step: "photo", required: true, hasPhoto: false };

function resolved(scope: ProfileCompletionScope, progress = complete) {
  const pending = reduce(INITIAL_PROFILE_COMPLETION_CHECK, { type: "start", scope });
  return reduce(pending, { type: "resolve", scope, progress });
}

test("initial and unresolved status reads stay pending until server evidence arrives", () => {
  assert.deepEqual(read(INITIAL_PROFILE_COMPLETION_CHECK, memberA), { status: "pending" });
  const pending = reduce(INITIAL_PROFILE_COMPLETION_CHECK, { type: "start", scope: memberA });
  assert.deepEqual(read(pending, memberA), { status: "pending" });
  assert.deepEqual(read(resolved(memberA), memberA), { status: "ready", progress: complete });
});

test("an account switch hides the previous completed result before the new effect starts", () => {
  const old = resolved(memberA);
  assert.deepEqual(read(old, memberB), { status: "pending" });
  const switched = reduce(old, { type: "start", scope: memberB });
  assert.deepEqual(read(switched, memberB), { status: "pending" });
  assert.deepEqual(read(reduce(switched, { type: "resolve", scope: memberB, progress: photo }), memberB), {
    status: "ready", progress: photo,
  });
});

test("late success or failure from another account cannot replace current pending state", () => {
  const pending = reduce(resolved(memberA), { type: "start", scope: memberB });
  assert.equal(reduce(pending, { type: "resolve", scope: memberA, progress: complete }), pending);
  assert.equal(reduce(pending, { type: "reject", scope: memberA }), pending);
  assert.deepEqual(read(pending, memberB), { status: "pending" });
});

test("late account responses cannot overwrite an incomplete current result", () => {
  const current = resolved(memberB, photo);
  assert.equal(reduce(current, { type: "resolve", scope: memberA, progress: complete }), current);
  assert.equal(reduce(current, { type: "reject", scope: memberA }), current);
  assert.deepEqual(read(current, memberB), { status: "ready", progress: photo });
});

test("navigation invalidates completed evidence before the next effect and rejects stale reads", () => {
  const next = { ...memberA, pathname: "/feed/messages" };
  const old = resolved(memberA);
  assert.deepEqual(read(old, next), { status: "pending" });
  const pending = reduce(old, { type: "start", scope: next });
  assert.equal(reduce(pending, { type: "resolve", scope: memberA, progress: complete }), pending);
  assert.deepEqual(read(pending, next), { status: "pending" });
});

test("failure stays closed and retry cannot temporarily reuse the old result", () => {
  const failed = reduce(resolved(memberA), { type: "reject", scope: memberA });
  assert.deepEqual(read(failed, memberA), { status: "error" });
  const retry = { ...memberA, reload: 1 };
  assert.deepEqual(read(failed, retry), { status: "pending" });
  const pending = reduce(failed, { type: "start", scope: retry });
  assert.equal(reduce(pending, { type: "resolve", scope: memberA, progress: complete }), pending);
  assert.equal(reduce(pending, { type: "reject", scope: memberA }), pending);
  assert.deepEqual(read(pending, retry), { status: "pending" });
  assert.deepEqual(read(reduce(pending, { type: "resolve", scope: retry, progress: complete }), retry), {
    status: "ready", progress: complete,
  });
});

test("sign-out clears completion and discards a late in-flight response", () => {
  const reset = reduce(resolved(memberA), { type: "reset" });
  assert.deepEqual(read(reset, memberA), { status: "pending" });
  assert.equal(reduce(reset, { type: "resolve", scope: memberA, progress: complete }), reset);
});

test("verification-first and photo-first server results are preserved without invented completion", () => {
  for (const progress of [
    { ...complete, step: "pending_verification" as const, required: true, adultVerified: false },
    photo,
    { ...complete, step: "first_post" as const, required: true, hasPost: false },
  ]) {
    assert.deepEqual(read(resolved(memberA, progress), memberA), { status: "ready", progress });
  }
});
