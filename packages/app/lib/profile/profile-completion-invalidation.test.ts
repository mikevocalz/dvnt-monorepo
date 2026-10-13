import assert from "node:assert/strict";
import { test } from "node:test";
import {
  invalidateProfileCompletion,
  subscribeProfileCompletionInvalidation,
} from "./profile-completion-invalidation.ts";

test("successful writes signal the stable member without inferring completion", () => {
  const seen: string[] = [];
  const unsubscribe = subscribeProfileCompletionInvalidation((id) => seen.push(id));
  try {
    invalidateProfileCompletion({ id: "row-a", authId: "auth-a" });
    invalidateProfileCompletion({ id: "row-a", authId: "auth-a" });
    invalidateProfileCompletion({ id: "legacy-b" });
    invalidateProfileCompletion(null);
    invalidateProfileCompletion({});
    assert.deepEqual(seen, ["auth-a", "auth-a", "legacy-b"]);
  } finally { unsubscribe(); }
  invalidateProfileCompletion({ authId: "auth-a" });
  assert.equal(seen.length, 3);
});
