import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { hydrateAuthProfile } from "./hydrate-auth-profile.ts";
import { computeProfileCompletion } from "../stores/profile-completion.ts";

const complete = {
  id: "7", authId: "fixture-owner", username: "fixture", email: "fixture@example.test", name: "Fixture",
  avatar: "https://example.test/a.jpg", bio: "Hello", location: "City", links: ["https://example.test"],
  sexuality: ["fixture-choice"], eventAudience: "fixture-audience", pronouns: "fixture-pronouns", gender: "fixture-gender",
  isVerified: true, postsCount: 1, followersCount: 0, followingCount: 0,
};
test("auth-sync owner fields survive hydration and compute 100", () => {
  const user = hydrateAuthProfile(complete);
  for (const key of ["authId", "sexuality", "eventAudience", "links", "gender", "pronouns"] as const) assert.deepEqual(user[key], complete[key]);
  assert.equal(computeProfileCompletion(user).percent, 100);
});
test("hydration does not invent fields or merge the previous account", () => {
  hydrateAuthProfile(complete);
  const { sexuality, eventAudience, links, ...partial } = complete;
  const next = hydrateAuthProfile({ ...partial, id: "8", authId: "fixture-next" });
  assert.equal(next.sexuality, undefined);
  assert.equal(next.eventAudience, undefined);
  assert.equal(next.links, undefined);
  assert.equal(computeProfileCompletion(next).percent, 60);
});
test("all sign-in/signup adapters use the same owner-profile hydration", () => {
  for (const path of [
    "packages/app/features/auth/screens/LoginScreen.web.tsx",
    "packages/app/features/auth/screens/SignupScreen.web.tsx",
    "packages/app/features/routes/screens/(auth)/login.tsx",
    "packages/app/features/signup/ui/SignUpStep2.tsx",
    "packages/app/features/auth/ui/apple-button.tsx",
    "apps/web/src/app/(frontend)/auth/social-callback/page.tsx",
  ]) {
    const source = readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
    assert.match(source, /hydrateAuthProfile\(profile/, path);
    assert.doesNotMatch(source, /id: profile\.id/, `${path} must not reconstruct a lossy whitelist`);
  }
});
