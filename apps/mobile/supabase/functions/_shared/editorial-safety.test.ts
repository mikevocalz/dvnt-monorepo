import { assertEquals } from "jsr:@std/assert";
import {
  boundAccountAuthId,
  isEngagementAction,
  isVerifiedAdultRow,
  isVisualLane,
  nextStageAfterBlocklist,
  obviousTextBlocklist,
  readProfilePatch,
  requiresHumanApproval,
  sourcePolicySatisfied,
} from "./editorial-safety.ts";

const NOW = new Date("2026-10-02T00:00:00Z");

Deno.test("isVisualLane finds image and video in any position", () => {
  assertEquals(isVisualLane(["image", "video", "text"]), true);
  assertEquals(isVisualLane(["text", "image"]), true);
  assertEquals(isVisualLane(["text", "video"]), true);
  assertEquals(isVisualLane(["text"]), false);
  assertEquals(isVisualLane([]), false);
});

Deno.test("isVisualLane refuses anything that is not an array", () => {
  for (const bad of [null, undefined, "image", 7, { 0: "image" }]) {
    assertEquals(isVisualLane(bad), false, JSON.stringify(bad) ?? "undef");
  }
});

Deno.test("a visual lane cannot switch off human approval", () => {
  // The whole of H6: a seed row with requires_human_approval flipped false.
  for (const types of [["image"], ["video"], ["image", "video", "text"]]) {
    assertEquals(
      requiresHumanApproval({
        allowed_content_types: types,
        requires_human_approval: false,
      }),
      true,
      types.join(","),
    );
  }
});

Deno.test("a text-only lane keeps the operator switch", () => {
  assertEquals(
    requiresHumanApproval({
      allowed_content_types: ["text"],
      requires_human_approval: false,
    }),
    false,
  );
  assertEquals(
    requiresHumanApproval({
      allowed_content_types: ["text"],
      requires_human_approval: true,
    }),
    true,
  );
});

Deno.test("an unreadable allowed_content_types still requires approval", () => {
  assertEquals(requiresHumanApproval({}), true);
  assertEquals(
    requiresHumanApproval({ allowed_content_types: null, requires_human_approval: false }),
    false,
  );
});

Deno.test("obviousTextBlocklist catches the three phrases verbatim", () => {
  const hit = obviousTextBlocklist({ caption: "Child Sexual content" }, {});
  assertEquals(hit.passed, false);
  assertEquals(hit.reasons, ["child sexual"]);
});

Deno.test("obviousTextBlocklist reads nested payload values", () => {
  const hit = obviousTextBlocklist({ a: { b: ["non-consensual"] } }, {});
  assertEquals(hit.passed, false);
  assertEquals(hit.reasons, ["non-consensual"]);
});

Deno.test("obviousTextBlocklist is a substring scan, not moderation", () => {
  // Documented limits, asserted so nobody mistakes a pass for a safety verdict.
  assertEquals(obviousTextBlocklist({ caption: "ch1ld s3xual" }, {}).passed, true);
  assertEquals(obviousTextBlocklist({ url: "https://x/img.jpg" }, {}).passed, true);
  assertEquals(obviousTextBlocklist(null, {}).passed, true);
});

Deno.test("the astrology lane carries its entertainment disclosure", () => {
  assertEquals(
    obviousTextBlocklist({}, { slug: "astrology" }).disclosure,
    "For entertainment/editorial purposes.",
  );
  assertEquals(obviousTextBlocklist({}, { slug: "headline-news" }).disclosure, undefined);
});

Deno.test("nextStageAfterBlocklist rejects a hit regardless of lane", () => {
  const failed = { passed: false, reasons: ["minor nude"] };
  assertEquals(nextStageAfterBlocklist({ allowed_content_types: ["text"] }, failed), "rejected");
  assertEquals(nextStageAfterBlocklist({ allowed_content_types: ["image"] }, failed), "rejected");
});

Deno.test("a clean visual payload parks at awaiting_approval, never approved", () => {
  const passed = { passed: true, reasons: [] };
  assertEquals(
    nextStageAfterBlocklist(
      { allowed_content_types: ["image", "video"], requires_human_approval: false },
      passed,
    ),
    "awaiting_approval",
  );
});

Deno.test("a clean text payload on an auto lane reaches approved", () => {
  assertEquals(
    nextStageAfterBlocklist(
      { allowed_content_types: ["text"], requires_human_approval: false },
      { passed: true, reasons: [] },
    ),
    "approved",
  );
});

Deno.test("sourcePolicySatisfied needs a citation when the lane demands one", () => {
  for (const key of [
    "citations_required",
    "current_sources_required",
    "citations_required_for_news",
  ]) {
    const profile = { source_policy: { [key]: true } };
    assertEquals(sourcePolicySatisfied(profile, []), false, key);
    assertEquals(sourcePolicySatisfied(profile, [{ url: "https://dvnt.app" }]), true, key);
  }
});

Deno.test("sourcePolicySatisfied rejects a quote with no url", () => {
  const profile = { source_policy: { quote_source_required: true } };
  assertEquals(sourcePolicySatisfied(profile, [{ quote: "said a thing" }]), false);
  assertEquals(
    sourcePolicySatisfied(profile, [{ quote: "said a thing", url: "https://dvnt.app" }]),
    true,
  );
});

Deno.test("sourcePolicySatisfied passes an open lane and tolerates junk sources", () => {
  assertEquals(sourcePolicySatisfied({}, []), true);
  assertEquals(sourcePolicySatisfied({ source_policy: {} }, "not-an-array"), true);
  assertEquals(
    sourcePolicySatisfied({ source_policy: { quote_source_required: true } }, [null, 7, "x"]),
    true,
  );
});

Deno.test("readProfilePatch rejects a body with no patch key", () => {
  // H5: this exact body used to throw a TypeError out of the handler.
  assertEquals(readProfilePatch({ action: "profile" }), {
    ok: false,
    error: "A profile patch object is required",
  });
});

Deno.test("readProfilePatch rejects a non-object patch", () => {
  for (const bad of [null, "patch", 7, true, ["enabled"]]) {
    assertEquals(
      readProfilePatch({ patch: bad }).ok,
      false,
      JSON.stringify(bad) ?? "undef",
    );
  }
  assertEquals(readProfilePatch(undefined).ok, false);
  assertEquals(readProfilePatch("body").ok, false);
});

Deno.test("readProfilePatch keeps only allow-listed keys", () => {
  const read = readProfilePatch({
    patch: { enabled: true, slug: "hijack", id: "x", account_auth_id: "auth-1" },
  });
  assertEquals(read.ok && read.patch, { enabled: true, account_auth_id: "auth-1" });
});

Deno.test("readProfilePatch rejects a patch of only unknown keys", () => {
  assertEquals(readProfilePatch({ patch: { slug: "hijack" } }), {
    ok: false,
    error: "No editable profile fields in the patch",
  });
});

Deno.test("readProfilePatch keeps a false and a null the admin meant to set", () => {
  const read = readProfilePatch({ patch: { enabled: false, account_auth_id: null } });
  assertEquals(read.ok && read.patch, { enabled: false, account_auth_id: null });
});

Deno.test("boundAccountAuthId returns the id a patch wants to bind", () => {
  assertEquals(boundAccountAuthId({ account_auth_id: "  auth-7 " }), "auth-7");
  assertEquals(boundAccountAuthId({ account_auth_id: 42 }), "42");
});

Deno.test("boundAccountAuthId returns null when the binding is untouched", () => {
  assertEquals(boundAccountAuthId({ enabled: true }), null);
  assertEquals(boundAccountAuthId({ account_auth_id: null }), null);
});

Deno.test("boundAccountAuthId returns an empty string for a blank id", () => {
  // Distinct from null: the caller must reject it rather than skip the check.
  assertEquals(boundAccountAuthId({ account_auth_id: "   " }), "");
});

Deno.test("isVerifiedAdultRow needs a passed row and an adult DOB", () => {
  assertEquals(isVerifiedAdultRow({ status: "passed", date_of_birth: "1990-01-01" }, NOW), true);
  assertEquals(isVerifiedAdultRow({ status: "review", date_of_birth: "1990-01-01" }, NOW), false);
  assertEquals(isVerifiedAdultRow({ status: "passed", date_of_birth: "2015-01-01" }, NOW), false);
});

Deno.test("isVerifiedAdultRow fails closed on a missing or unreadable DOB", () => {
  assertEquals(isVerifiedAdultRow(null, NOW), false);
  assertEquals(isVerifiedAdultRow(undefined, NOW), false);
  assertEquals(isVerifiedAdultRow({ status: "passed" }, NOW), false);
  assertEquals(isVerifiedAdultRow({ status: "passed", date_of_birth: "" }, NOW), false);
  assertEquals(isVerifiedAdultRow({ status: "passed", date_of_birth: "not a date" }, NOW), false);
});

Deno.test("isVerifiedAdultRow is exact on the eighteenth birthday", () => {
  const birthday = new Date("2026-10-02T00:00:00Z");
  assertEquals(isVerifiedAdultRow({ status: "passed", date_of_birth: "2008-10-02" }, birthday), true);
  assertEquals(isVerifiedAdultRow({ status: "passed", date_of_birth: "2008-10-03" }, birthday), false);
});

Deno.test("isEngagementAction allows only the three stored actions", () => {
  assertEquals(isEngagementAction("like"), true);
  assertEquals(isEngagementAction("follow"), true);
  assertEquals(isEngagementAction("comment"), true);
  for (const bad of ["dm", "", null, undefined, 7, "LIKE"]) {
    assertEquals(isEngagementAction(bad), false, JSON.stringify(bad) ?? "undef");
  }
});
