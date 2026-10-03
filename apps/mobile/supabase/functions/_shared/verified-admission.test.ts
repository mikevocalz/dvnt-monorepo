// resolveVerifiedAdmission's behaviour when the policy row cannot be read.
//
// This gate used to fall back to "enforcement off" on a failed policy read,
// which was inert while `enforce` was false everywhere. Once an operator sets
// `enforce = true`, that fallback would admit every unverified account. These
// cases pin the direction so the lenient version cannot come back unnoticed.

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

/** Enforcing, with a grace window that has already closed. */
const ENFORCING_POLICY = {
  enforce: true,
  grace_deadline: "2026-01-01T00:00:00Z",
  allowlist: [],
  denylist: [],
};

/** Enforcing with no deadline set: the default once the operator flips
 *  `enforce`. Grace is opt-in, so this refuses at once. */
const NO_GRACE_POLICY = { ...ENFORCING_POLICY, grace_deadline: null };

/** Enforcing with a grace window still open. */
const OPEN_GRACE_POLICY = { ...ENFORCING_POLICY, grace_deadline: "2999-01-01T00:00:00Z" };

/** An account that predates any rollout. Checklist A03: still in scope. */
const EXISTING_ACCOUNT = { createdAt: "2024-03-01T00:00:00Z" };

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

Deno.test("with no deadline set, an unverified account is blocked: grace is off by default", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { data: NO_GRACE_POLICY, error: null },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
    }),
    "user_abc",
  );
  assertEquals(verdict.state, "blocked");
  assertEquals(verdict.deadline, null);
});

Deno.test("an existing unverified account is blocked too, not grandfathered", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      // A cohort date left on the row from an earlier rollout plan exempts
      // nobody: the gate no longer reads it.
      verified_admission_policy: {
        data: { ...NO_GRACE_POLICY, cohort_created_after: "2026-09-10T00:00:00Z" },
        error: null,
      },
      identity_verifications: { data: null, error: null },
      user: { data: EXISTING_ACCOUNT, error: null },
    }),
    "user_old",
  );
  assertEquals(verdict.state, "blocked");
  assertEquals(verdict.reason, "verification_required");
});

Deno.test("an operator-set future deadline still gives grace", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { data: OPEN_GRACE_POLICY, error: null },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
    }),
    "user_abc",
  );
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
