import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySneakyLynkError } from "../../errors.ts";
import { webJoinFeedback, webConnectionFeedback } from "./room-status.ts";

test("web room capacity copy offers a real manual retry, not a fake notification", () => {
  const result = webJoinFeedback(classifySneakyLynkError("conflict", "Room is full"));
  assert.equal(result.retry, true);
  assert.doesNotMatch(result.body, /notify|moment one opens|slide you/i);
});
test("join recovery does not expose backend strings or retry forbidden admission", () => {
  for (const code of ["forbidden", "unauthorized", "not_found"]) {
    const result = webJoinFeedback(classifySneakyLynkError(code, "SECRET backend details"));
    assert.equal(result.retry, false);
    assert.doesNotMatch(result.body, /SECRET/);
  }
  assert.equal(webJoinFeedback(null).retry, true);
  assert.equal(webJoinFeedback(classifySneakyLynkError("internal_error", "SECRET")).retry, true);
});
test("connection status only reports connected for live media", () => {
  assert.equal(webConnectionFeedback("live").attention, false);
  for (const state of ["idle", "requesting-token", "connecting", "reconnecting", "error", "ended"] as const) {
    assert.equal(webConnectionFeedback(state).attention, true);
    assert.notEqual(webConnectionFeedback(state).label, "Connected");
  }
  assert.doesNotMatch(webConnectionFeedback("error").detail!, /automatically|retrying/i);
});
