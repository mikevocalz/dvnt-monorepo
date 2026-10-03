import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeVerificationState as clientState, canUseSpicyContent } from "./verification-state.ts";
import { normalizeVerificationState as serverState } from "../../../../apps/mobile/supabase/functions/_shared/verification-state.ts";

const now = new Date("2026-10-01T12:00:00Z");
const decide = (record: any) => {
  const client = clientState(record, now);
  const server = serverState(record, now);
  assert.deepEqual(client, server);
  return client;
};

test("no record is not_started and retryable", () => {
  const result = decide(null);
  assert.equal(result.state, "not_started");
  assert.equal(result.retryable, true);
  assert.equal(canUseSpicyContent(result), false);
});

test("pending/submitted/review remain pending", () => {
  for (const status of ["pending", "submitted", "review"]) {
    assert.equal(decide({ status, date_of_birth: null }).state, "pending");
  }
});

test("passed requires a readable adult DOB", () => {
  assert.equal(decide({ status: "passed", date_of_birth: "1990-06-01" }).state, "approved");
  assert.equal(decide({ status: "passed", date_of_birth: null }).state, "retry_required");
  assert.equal(canUseSpicyContent(decide({ status: "passed", date_of_birth: "1990-06-01" })), true);
});

test("underage and duplicate identity are hard rejected", () => {
  assert.equal(decide({ status: "failed", date_of_birth: "2010-01-01", failure_code: "underage" }).state, "rejected");
  const duplicate = decide({ status: "review", date_of_birth: "1990-01-01", failure_code: "duplicate_identity" });
  assert.equal(duplicate.state, "rejected");
  assert.equal(duplicate.retryable, false);
});

test("failed/expired evidence can be retried", () => {
  for (const status of ["failed", "expired"]) {
    const result = decide({ status, failure_code: "document_unreadable" });
    assert.equal(result.state, "retry_required");
    assert.equal(result.retryable, true);
  }
});
