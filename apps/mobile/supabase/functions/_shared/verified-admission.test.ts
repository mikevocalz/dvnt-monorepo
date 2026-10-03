// resolveVerifiedAdmission's behaviour when the policy row cannot be read.
//
// This gate used to fall back to "enforcement off" on a failed policy read,
// which was inert while `enforce` was false everywhere. Once
// 20261001190000_new_signup_verified_admission.sql sets `enforce = true`, that
// fallback admits every unverified in-scope account. These cases pin the
// direction so the lenient version cannot come back unnoticed.

import { assertEquals } from "jsr:@std/assert@1";
import { resolveVerifiedAdmission } from "./verified-admission.ts";

type Result = { data?: unknown; error?: { message: string } | null };

/** Minimal stand-in for the three chained reads resolveVerifiedAdmission makes. */
function fakeDb(results: Record<string, Result>) {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(results[table] ?? { data: null, error: null }),
      };
      return chain;
    },
  };
}

/** Enforcing, with the grace window already over. This is the state the
 *  migration produces: it sets `grace_deadline = now()`, so by the time any
 *  request arrives the deadline is in the past. */
const ENFORCING_POLICY = {
  enforce: true,
  cohort_created_after: "2020-01-01T00:00:00Z",
  grace_deadline: "2026-01-01T00:00:00Z",
  allowlist: [],
  denylist: [],
};

/** Enforcing with no deadline set. An unverified in-scope account gets `grace`
 *  here rather than `blocked`, which is deliberate: the operator has turned
 *  enforcement on but has not said when the window closes. */
const OPEN_ENDED_GRACE_POLICY = { ...ENFORCING_POLICY, grace_deadline: null };

const ACCOUNT = { createdAt: "2026-09-01T00:00:00Z" };

Deno.test("a failed policy read blocks instead of admitting", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { error: { message: "connection reset" } },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
    }),
    "user_abc",
  );
  assertEquals(verdict.state, "blocked");
  assertEquals(verdict.reason, "verification_required");
});

Deno.test("the block message does not claim anything about the account's verification", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { error: { message: "connection reset" } },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
    }),
    "user_abc",
  );
  // "Verify your ID to continue" would assert a state we never read.
  assertEquals(verdict.message?.includes("can't confirm your access"), true);
});

Deno.test("an unverified in-scope account is blocked once the grace window has closed", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { data: ENFORCING_POLICY, error: null },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
    }),
    "user_abc",
  );
  assertEquals(verdict.state, "blocked");
});

Deno.test("with no deadline set, an unverified in-scope account gets grace, not a block", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { data: OPEN_ENDED_GRACE_POLICY, error: null },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
    }),
    "user_abc",
  );
  // Pins the distinction the fail-closed change must not blur: a readable
  // policy with an open-ended window still lets the account participate, while
  // an UNREADABLE policy does not.
  assertEquals(verdict.state, "grace");
});

Deno.test("enforcement off still admits, so the fix did not close the gate on everyone", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { data: { ...ENFORCING_POLICY, enforce: false }, error: null },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
    }),
    "user_abc",
  );
  assertEquals(verdict.state, "allowed");
  assertEquals(verdict.reason, "not_enforced");
});
