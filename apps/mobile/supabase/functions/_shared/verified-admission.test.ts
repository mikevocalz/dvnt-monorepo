// resolveVerifiedAdmission's behaviour when the policy row cannot be read.
//
// This gate used to fall back to "enforcement off" on a failed policy read,
// which was inert while `enforce` was false everywhere. Once an operator sets
// `enforce = true`, that fallback would admit every unverified account. These
// cases pin the direction so the lenient version cannot come back unnoticed.

import { assertEquals } from "jsr:@std/assert@1";
import { resolveVerifiedAdmission } from "./verified-admission.ts";

type Result = { data?: unknown; error?: { message: string; code?: string } | null };

/** Minimal stand-in for the reads resolveVerifiedAdmission makes. The
 *  restricted-profile RPC answers "not restricted" unless a case says so. */
function fakeDb(results: Record<string, Result>) {
  return {
    rpcCalls: [] as string[],
    rpc(name: string) {
      this.rpcCalls.push(name);
      return Promise.resolve(results[`rpc:${name}`] ?? { data: false, error: null });
    },
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(results[table] ?? { data: null, error: null }),
        limit: () => Promise.resolve(results[table] ?? { data: [], error: null }),
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

// ── Checkout-created restricted profiles ─────────────────────────────────────
// These accounts skipped signup's date-of-birth check, so the rollout switch
// must not be what keeps them out: they stay locked with enforce = false.

const OFF_POLICY = { ...ENFORCING_POLICY, enforce: false };

Deno.test("a restricted profile is blocked from participation with enforcement off", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { data: OFF_POLICY, error: null },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
      "rpc:is_checkout_restricted": { data: true, error: null },
    }),
    "user_abc",
  );
  assertEquals(verdict.state, "blocked");
  assertEquals(verdict.reason, "restricted_profile");
});

Deno.test("the allowlist does not unlock a restricted profile", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { data: { ...ENFORCING_POLICY, allowlist: ["user_abc"] }, error: null },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
      "rpc:is_checkout_restricted": { data: true, error: null },
    }),
    "user_abc",
  );
  assertEquals(verdict.reason, "restricted_profile");
});

Deno.test("a restricted profile can still buy tickets", async () => {
  const db = fakeDb({
    verified_admission_policy: { data: OFF_POLICY, error: null },
    identity_verifications: { data: null, error: null },
    user: { data: ACCOUNT, error: null },
    "rpc:is_checkout_restricted": { data: true, error: null },
  });
  const verdict = await resolveVerifiedAdmission(db, "user_abc", undefined, { purpose: "ticket_purchase" });
  assertEquals(verdict.state, "allowed");
  assertEquals(db.rpcCalls, []);
});

Deno.test("a passed adult verification unlocks a restricted profile", async () => {
  const verdict = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { data: OFF_POLICY, error: null },
      identity_verifications: { data: { user_id: "user_abc", status: "passed", date_of_birth: "1990-01-01" }, error: null },
      user: { data: ACCOUNT, error: null },
      // The SQL already answers false once verification passes; the TS
      // decision agrees even if a stale true slips through.
      "rpc:is_checkout_restricted": { data: true, error: null },
    }),
    "user_abc",
  );
  assertEquals(verdict.state, "allowed");
});

Deno.test("an unreadable restricted flag refuses, a missing function does not", async () => {
  const unknown = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { data: OFF_POLICY, error: null },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
      "rpc:is_checkout_restricted": { data: null, error: { message: "timeout", code: "57014" } },
    }),
    "user_abc",
  );
  assertEquals(unknown.state, "blocked");

  const notMigrated = await resolveVerifiedAdmission(
    fakeDb({
      verified_admission_policy: { data: OFF_POLICY, error: null },
      identity_verifications: { data: null, error: null },
      user: { data: ACCOUNT, error: null },
      "rpc:is_checkout_restricted": { data: null, error: { message: "not found", code: "PGRST202" } },
    }),
    "user_abc",
  );
  assertEquals(notMigrated.state, "allowed");
});

Deno.test("new-account participation is blocked until saved photo then first post", async () => {
  const account = {
    id: "new-member",
    createdAt: "2026-10-09T01:00:00Z",
    emailVerified: true,
    image: null,
  };
  const base = {
    verified_admission_policy: { data: { enforce: false }, error: null },
    identity_verifications: {
      data: { user_id: "new-member", status: "passed", date_of_birth: "1995-01-01" },
      error: null,
    },
    user: { data: account, error: null },
    users: { data: { id: 555, avatar_id: null }, error: null },
    posts: { data: [], error: null },
  };
  const photoMissing = await resolveVerifiedAdmission(fakeDb(base), "new-member");
  assertEquals(photoMissing.state, "blocked");
  assertEquals(photoMissing.reason, "profile_photo_required");

  const hasPhoto = {
    ...base,
    users: { data: { id: 555, avatar_id: 80 }, error: null },
    media: { data: { url: "https://cdn.dvntapp.live/photo.jpg" }, error: null },
  };
  const noFirstPost = await resolveVerifiedAdmission(fakeDb(hasPhoto), "new-member");
  assertEquals(noFirstPost.state, "blocked");
  assertEquals(noFirstPost.reason, "first_post_required");

  const firstPostAllowed = await resolveVerifiedAdmission(
    fakeDb(hasPhoto), "new-member", new Date("2026-10-09T02:00:00Z"),
    { purpose: "first_post" },
  );
  assertEquals(firstPostAllowed.state, "allowed");

  const complete = await resolveVerifiedAdmission(
    fakeDb({ ...hasPhoto, posts: { data: [{ id: 1 }], error: null } }), "new-member",
  );
  assertEquals(complete.state, "allowed");
});

Deno.test("new onboarding must never close ticket purchase", async () => {
  const db = fakeDb({
    verified_admission_policy: { data: { enforce: false }, error: null },
    identity_verifications: { data: null, error: null },
    user: { data: { id: "new-member", createdAt: "2026-10-09T01:00:00Z" }, error: null },
  });
  const decision = await resolveVerifiedAdmission(db, "new-member", new Date(), { purpose: "ticket_purchase" });
  assertEquals(decision.state, "allowed");
});
