import { assertEquals } from "jsr:@std/assert@1";
import { determineNewMemberStep, isNewMemberOnboardingEnabled } from "./new-member-onboarding.ts";

const evidence = {
  accountCreatedAt: "2026-10-09T00:31:00.000Z",
  emailVerified: true,
  adultVerified: true,
  hasProfilePhoto: false,
  hasPost: false,
};

Deno.test("legacy accounts are retroactively required to add photo and first post", () => {
  assertEquals(
    determineNewMemberStep({ ...evidence, accountCreatedAt: "2024-01-01T00:00:00.000Z" }),
    "photo",
  );
  assertEquals(determineNewMemberStep({ ...evidence, accountCreatedAt: null }), "photo");
});

Deno.test("photo stage always precedes first post", () => {
  assertEquals(determineNewMemberStep(evidence), "photo");
  assertEquals(determineNewMemberStep({ ...evidence, hasProfilePhoto: true }), "first_post");
  assertEquals(determineNewMemberStep({ ...evidence, hasPost: true }), "photo");
  assertEquals(
    determineNewMemberStep({ ...evidence, hasProfilePhoto: true, hasPost: true }),
    "complete",
  );
});

Deno.test("email and adult-verification state do not exempt the two required profile steps", () => {
  assertEquals(determineNewMemberStep({ ...evidence, emailVerified: false }), "photo");
  assertEquals(determineNewMemberStep({ ...evidence, adultVerified: false }), "photo");
  assertEquals(
    determineNewMemberStep({
      ...evidence,
      emailVerified: false,
      adultVerified: false,
      hasProfilePhoto: true,
    }),
    "first_post",
  );
});

Deno.test("the photo + first-post gate cannot be disabled by an environment flag", () => {
  assertEquals(isNewMemberOnboardingEnabled(() => undefined), true);
  assertEquals(isNewMemberOnboardingEnabled(() => "false"), true);
  assertEquals(isNewMemberOnboardingEnabled(() => "true"), true);
});
