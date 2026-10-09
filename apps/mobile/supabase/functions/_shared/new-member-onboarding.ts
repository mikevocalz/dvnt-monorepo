/**
 * Mandatory welcome steps for accounts created after the 2026-10-09 rollout.
 * Account age is the Better Auth creation timestamp, not a localStorage bit.
 * The status is recomputed from authoritative server-side media/posts.
 * Existing accounts are NOT retroactively locked out by this requirement.
 */
export const NEW_MEMBER_ONBOARDING_CUTOFF = "2026-10-09T00:30:00.000Z";

/**
 * The gate stays off until DVNT_NEW_MEMBER_ONBOARDING_ENABLED is exactly
 * "true". Native builds without the photo/first-post screens would trap new
 * signups, and the gate also requires ID verification, so it must not go live
 * on deploy. Turn it on once those builds have reached users, and move
 * NEW_MEMBER_ONBOARDING_CUTOFF to that date in the same change.
 */
export function isNewMemberOnboardingEnabled(
  read: (name: string) => string | undefined = (name) =>
    (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name),
): boolean {
  return (read("DVNT_NEW_MEMBER_ONBOARDING_ENABLED") ?? "").trim() === "true";
}

export interface OnboardingEvidence {
  accountCreatedAt: string | null | undefined;
  emailVerified: boolean;
  adultVerified: boolean;
  hasProfilePhoto: boolean;
  hasPost: boolean;
}
export type OnboardingStep = "not_required" | "pending_verification" | "photo" | "first_post" | "complete";

export function determineNewMemberStep(input: OnboardingEvidence): OnboardingStep {
  const created = Date.parse(String(input.accountCreatedAt ?? ""));
  if (!Number.isFinite(created) || created < Date.parse(NEW_MEMBER_ONBOARDING_CUTOFF))
    return "not_required";
  // Signup must finish identity/email verification first. No shortcuts around 18+.
  if (!input.emailVerified || !input.adultVerified) return "pending_verification";
  if (!input.hasProfilePhoto) return "photo";
  if (!input.hasPost) return "first_post";
  return "complete";
}
