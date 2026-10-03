import { test } from "node:test";
import assert from "node:assert/strict";
import { decideVerifiedAdmission as decideClient } from "./verified-admission.ts";
import {
  decideVerifiedAdmission as decideServer,
  admissionRefusal,
  type AdmissionContext,
  type AdmissionVerdict,
} from "../../../../apps/mobile/supabase/functions/_shared/verified-admission.ts";

const now = new Date("2026-09-16T00:00:00Z");
const ENFORCED = { enforce: true, grace_deadline: "2026-12-01T00:00:00Z" };
const MEMBER = "auth_member";

/** The server owns the decision; the client mirror must never disagree with it. */
function decide(input: AdmissionContext): AdmissionVerdict {
  const server = decideServer({ now, ...input });
  const client = decideClient({ now, ...input } as never);
  assert.deepEqual(client, server, `client mirror disagreed for ${JSON.stringify(input)}`);
  return server;
}

test("enforcement off admits every account, verified or not", () => {
  for (const policy of [null, { enforce: false, grace_deadline: "2020-01-01T00:00:00Z" }]) {
    const verdict = decide({ userId: MEMBER, policy, record: null });
    assert.equal(verdict.state, "allowed");
    assert.equal(verdict.reason, "not_enforced");
    assert.equal(verdict.message, null);
  }
  // A long-dormant, never-verified legacy account is untouched by merging this.
  assert.equal(
    decide({ userId: MEMBER, policy: { enforce: false }, record: { user_id: MEMBER, status: "none" } }).state,
    "allowed",
  );
});

test("an in-scope unverified account is in grace until the deadline", () => {
  const verdict = decide({ userId: MEMBER, policy: ENFORCED, record: null });
  assert.equal(verdict.state, "grace");
  assert.equal(verdict.reason, "verification_required");
  assert.equal(verdict.deadline, "2026-12-01T00:00:00.000Z");
  assert.match(verdict.message ?? "", /verified-only from December 1, 2026/);
  assert.match(verdict.message ?? "", /posting, commenting, messaging, hosting and joining rooms/);
  assert.doesNotMatch(verdict.message ?? "", /ticket/);

  // No deadline set: grace is opt-in, so an enforced policy refuses at once.
  const noGrace = decide({ userId: MEMBER, policy: { enforce: true, grace_deadline: null }, record: null });
  assert.equal(noGrace.state, "blocked");
  assert.equal(noGrace.deadline, null);
  // An account that predates the rollout is in scope too (checklist A03):
  // a leftover cohort_created_after from an old policy row exempts nobody.
  const legacy = { enforce: true, cohort_created_after: "2026-09-10T00:00:00Z", grace_deadline: null };
  for (const accountCreatedAt of ["2019-04-02T10:00:00Z", null]) {
    const verdict = decide({ userId: MEMBER, accountCreatedAt, policy: legacy, record: null } as AdmissionContext);
    assert.equal(verdict.state, "blocked");
    assert.equal(verdict.reason, "verification_required");
  }

  // A submitted-but-undecided check is still inside grace, with its own reason.
  for (const status of ["pending", "submitted", "review"]) {
    const pending = decide({ userId: MEMBER, policy: ENFORCED, record: { user_id: MEMBER, status } });
    assert.equal(pending.state, "grace");
    assert.equal(pending.reason, "verification_incomplete");
  }
});

test("past the deadline participation is refused with an actionable reason", () => {
  const past = { ...ENFORCED, grace_deadline: "2026-09-01T00:00:00Z" };
  const verdict = decide({ userId: MEMBER, policy: past, record: null });
  assert.equal(verdict.state, "blocked");
  assert.equal(verdict.reason, "verification_required");
  assert.match(verdict.message ?? "", /Verify your ID/);
  assert.match(verdict.message ?? "", /account, your tickets and the verification flow stay open/);
  assert.deepEqual(admissionRefusal(verdict), {
    code: "verification_required",
    reason: "verification_required",
    message: verdict.message,
  });

  // The allowlist is the only exemption, and the denylist overrides it.
  assert.equal(decide({ userId: MEMBER, policy: past, record: null, exempt: true }).reason, "exempt");
  assert.equal(decide({ userId: MEMBER, policy: past, record: null, exempt: true, denied: true }).state, "blocked");
  // No signed-in account is refused outright, before any policy is consulted.
  assert.equal(decide({ userId: null, policy: null }).reason, "unauthenticated");
});

test("an approval without readable document date of birth does not admit", () => {
  const past = { ...ENFORCED, grace_deadline: "2026-09-01T00:00:00Z" };
  for (const dob of [null, undefined, "", "2000-02-30", "2030-01-01", 20000101, {}]) {
    const verdict = decide({ userId: MEMBER, policy: past, record: { user_id: MEMBER, status: "passed", date_of_birth: dob } });
    assert.equal(verdict.state, "blocked", String(dob));
    assert.equal(verdict.reason, "verification_incomplete", String(dob));
  }
  const failed = decide({ userId: MEMBER, policy: past, record: { user_id: MEMBER, status: "failed", date_of_birth: null } });
  assert.equal(failed.reason, "age_evidence_missing");
  assert.match(failed.message ?? "", /Submit it again/);
});

test("an under-18 document closes participation whatever the config says", () => {
  for (const policy of [null, { enforce: false }, ENFORCED]) {
    const verdict = decide({ userId: MEMBER, policy, record: { user_id: MEMBER, status: "failed", date_of_birth: "2008-09-17" } });
    assert.equal(verdict.state, "blocked");
    assert.equal(verdict.reason, "underage");
    assert.match(verdict.message ?? "", /under 18/);
  }
  // The day of the 18th birthday is an adult document, not an underage one.
  assert.equal(
    decide({ userId: MEMBER, policy: ENFORCED, record: { user_id: MEMBER, status: "passed", date_of_birth: "2008-09-16" } }).state,
    "allowed",
  );
});

test("a verified adult keeps participation after the deadline", () => {
  const past = { ...ENFORCED, grace_deadline: "2026-09-01T00:00:00Z" };
  const verdict = decide({ userId: MEMBER, policy: past, record: { user_id: MEMBER, status: "passed", date_of_birth: "1990-05-04" } });
  assert.equal(verdict.state, "allowed");
  assert.equal(verdict.reason, "verified");
  assert.equal(verdict.deadline, null);
});

test("verification status is never inherited across an account switch", () => {
  const past = { ...ENFORCED, grace_deadline: "2026-09-01T00:00:00Z" };
  const verified = { user_id: MEMBER, status: "passed", date_of_birth: "1990-05-04" };
  // Account A is verified.
  assert.equal(decide({ userId: MEMBER, policy: past, record: verified }).state, "allowed");
  // Account B, handed A's row by a stale cache or a mis-joined query, is refused.
  const switched = decide({ userId: "auth_other", policy: past, record: verified });
  assert.equal(switched.state, "blocked");
  assert.equal(switched.reason, "verification_required");
  // The same holds inside grace: B sees the prompt, not A's clearance.
  assert.equal(decide({ userId: "auth_other", policy: ENFORCED, record: verified }).state, "grace");
  // An under-18 row belonging to someone else does not block B either.
  assert.equal(
    decide({ userId: "auth_other", policy: null, record: { user_id: MEMBER, status: "failed", date_of_birth: "2008-09-17" } }).state,
    "allowed",
  );
});
