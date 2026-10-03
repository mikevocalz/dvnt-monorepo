import { assertEquals } from "jsr:@std/assert";
import {
  creatorStandingRefusal,
  decideCreatorStanding,
} from "./creator-standing.ts";

Deno.test("an account with no creator_hosts row still hosts", () => {
  for (const record of [null, undefined]) {
    const verdict = decideCreatorStanding({ userId: "u1", record });
    assertEquals(verdict.state, "allowed");
    assertEquals(verdict.reason, "not_enrolled");
    assertEquals(verdict.message, null);
  }
});

Deno.test("suspended, rejected and paused close hosting", () => {
  for (const status of ["suspended", "rejected", "paused"]) {
    const verdict = decideCreatorStanding({
      userId: "u1",
      record: { user_id: "u1", status },
    });
    assertEquals(verdict.state, "refused", status);
    assertEquals(verdict.reason, status);
    // Every refusal carries copy; a bare `false` leaves the client nothing to show.
    assertEquals(typeof verdict.message, "string", status);
  }
});

Deno.test("the working statuses keep hosting open", () => {
  for (const status of ["invited", "applied", "under_review", "approved"]) {
    const verdict = decideCreatorStanding({
      userId: "u1",
      record: { user_id: "u1", status },
    });
    assertEquals(verdict.state, "allowed", status);
    assertEquals(verdict.reason, "in_good_standing", status);
  }
});

Deno.test("a row belonging to another account is discarded, never inherited", () => {
  // The suspension must not follow a mis-joined row onto someone else.
  const borrowed = decideCreatorStanding({
    userId: "u1",
    record: { user_id: "u2", status: "suspended" },
  });
  assertEquals(borrowed.state, "allowed");
  assertEquals(borrowed.reason, "not_enrolled");

  // A row with no user_id is the account's own (the resolver filtered on it).
  const own = decideCreatorStanding({
    userId: "u1",
    record: { status: "suspended" },
  });
  assertEquals(own.state, "refused");
  assertEquals(own.reason, "suspended");
});

Deno.test("an unknown or absent status does not invent a refusal", () => {
  for (const status of [null, undefined, "", "   ", "future_tier"]) {
    const verdict = decideCreatorStanding({
      userId: "u1",
      record: { user_id: "u1", status },
    });
    assertEquals(verdict.state, "allowed", JSON.stringify(status));
  }
});

Deno.test("status matching is exact, so no near-miss passes the gate", () => {
  for (const status of ["Suspended", " suspended ", "suspended_pending"]) {
    const verdict = decideCreatorStanding({
      userId: "u1",
      record: { user_id: "u1", status },
    });
    // Trimmed values are refused; a different word is not silently refused.
    assertEquals(
      verdict.state,
      status.trim() === "suspended" ? "refused" : "allowed",
      status,
    );
  }
});

Deno.test("no user id is refused rather than treated as unenrolled", () => {
  for (const userId of [null, undefined, "", "  "]) {
    const verdict = decideCreatorStanding({ userId });
    assertEquals(verdict.state, "refused", JSON.stringify(userId));
    assertEquals(verdict.reason, "unauthenticated");
  }
});

Deno.test("the refusal body is one shape every rail can return", () => {
  const refusal = creatorStandingRefusal(
    decideCreatorStanding({
      userId: "u1",
      record: { user_id: "u1", status: "suspended" },
    }),
  );
  assertEquals(refusal.code, "creator_hosting_closed");
  assertEquals(refusal.reason, "suspended");
  assertEquals(refusal.message.length > 0, true);
});
