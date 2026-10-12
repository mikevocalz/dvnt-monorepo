import { assertEquals } from "jsr:@std/assert@1";
import { determineNewMemberStep, isNewMemberOnboardingEnabled } from "./new-member-onboarding.ts";

const newer = {
  accountCreatedAt: "2026-10-09T00:31:00.000Z",
  emailVerified: true,
  adultVerified: true,
  hasProfilePhoto: false,
  hasPost: false,
};

Deno.test("legacy accounts are retroactively required to add photo and first post", () => {
  assertEquals(
    determineNewMemberStep({ ...newer, accountCreatedAt: "2024-01-01T00:00:00.000Z" }),
    "photo",
  );
  assertEquals(determineNewMemberStep({ ...newer, accountCreatedAt: null }), "photo");
});

Deno.test("new signup keeps verification-first ordering", () => {
  assertEquals(determineNewMemberStep({ ...newer, emailVerified: false }), "pending_verification");
  assertEquals(determineNewMemberStep({ ...newer, adultVerified: false }), "pending_verification");
  assertEquals(
    determineNewMemberStep({
      ...newer,
      emailVerified: false,
      adultVerified: false,
      hasProfilePhoto: true,
      hasPost: true,
    }),
    "pending_verification",
  );
});

Deno.test("legacy profile requirements do not force legacy accounts through the new verification stage", () => {
  const legacy = {
    ...newer,
    accountCreatedAt: "2024-01-01T00:00:00.000Z",
    emailVerified: false,
    adultVerified: false,
  };
  assertEquals(determineNewMemberStep(legacy), "photo");
  assertEquals(determineNewMemberStep({ ...legacy, hasProfilePhoto: true }), "first_post");
});

Deno.test("photo stage always precedes first post", () => {
  assertEquals(determineNewMemberStep(newer), "photo");
  assertEquals(determineNewMemberStep({ ...newer, hasProfilePhoto: true }), "first_post");
  assertEquals(determineNewMemberStep({ ...newer, hasPost: true }), "photo");
  assertEquals(
    determineNewMemberStep({ ...newer, hasProfilePhoto: true, hasPost: true }),
    "complete",
  );
});

Deno.test("the photo + first-post gate cannot be disabled by an environment flag", () => {
  assertEquals(isNewMemberOnboardingEnabled(() => undefined), true);
  assertEquals(isNewMemberOnboardingEnabled(() => "false"), true);
  assertEquals(isNewMemberOnboardingEnabled(() => "true"), true);
});
