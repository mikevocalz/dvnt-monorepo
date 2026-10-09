import { assertEquals } from "jsr:@std/assert@1";
import { determineNewMemberStep, isNewMemberOnboardingEnabled } from "./new-member-onboarding.ts";

const newer = {
  accountCreatedAt: "2026-10-09T00:31:00.000Z",
  emailVerified: true,
  adultVerified: true,
  hasProfilePhoto: false,
  hasPost: false,
};

Deno.test("legacy accounts are never retroactively forced through setup", () => {
  assertEquals(determineNewMemberStep({ ...newer, accountCreatedAt: "2026-10-08T23:59:00.000Z" }), "not_required");
  assertEquals(determineNewMemberStep({ ...newer, accountCreatedAt: null }), "not_required");
});

Deno.test("new account must finish ID and email before photo/post", () => {
  assertEquals(determineNewMemberStep({ ...newer, emailVerified: false }), "pending_verification");
  assertEquals(determineNewMemberStep({ ...newer, adultVerified: false }), "pending_verification");
});

Deno.test("new member photo stage precedes first post, persisted across devices", () => {
  assertEquals(determineNewMemberStep(newer), "photo");
  assertEquals(determineNewMemberStep({ ...newer, hasProfilePhoto: true }), "first_post");
  assertEquals(determineNewMemberStep({ ...newer, hasPost: true }), "photo");
  assertEquals(determineNewMemberStep({ ...newer, hasProfilePhoto: true, hasPost: true }), "complete");
});

Deno.test("onboarding boundary uses the server enrollment timestamp", () => {
  assertEquals(determineNewMemberStep({
    ...newer, accountCreatedAt: "2026-10-09T00:30:00.000Z",
  }), "photo");
  assertEquals(determineNewMemberStep({
    ...newer, accountCreatedAt: "2026-10-09T00:29:59.999Z",
  }), "not_required");
});

Deno.test("the onboarding gate is off unless the flag is exactly true", () => {
  assertEquals(isNewMemberOnboardingEnabled(() => undefined), false);
  assertEquals(isNewMemberOnboardingEnabled(() => "1"), false);
  assertEquals(isNewMemberOnboardingEnabled(() => "TRUE"), false);
  assertEquals(isNewMemberOnboardingEnabled(() => " true "), true);
});
