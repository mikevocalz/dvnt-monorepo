/**
 * Mandatory DVNT entry steps for every member account.
 *
 * This used to apply only to accounts created after a rollout cutoff. That left
 * legacy accounts able to dismiss the profile-completion reminder forever.
 * Photo + first post are now account requirements for everyone. Progress is
 * recomputed from authoritative server-side media/posts on every check.
 *
 * Keep the old cutoff/flag exports for source compatibility with older callers;
 * they no longer weaken enforcement.
 */
export const NEW_MEMBER_ONBOARDING_CUTOFF = "2026-10-09T00:30:00.000Z";

/** @deprecated The photo + first-post gate is always enabled. */
export function isNewMemberOnboardingEnabled(
  _read?: (name: string) => string | undefined,
): boolean {
  return true;
}

export interface OnboardingEvidence {
  accountCreatedAt: string | null | undefined;
  emailVerified: boolean;
  adultVerified: boolean;
  hasProfilePhoto: boolean;
  hasPost: boolean;
}

export type OnboardingStep =
  | "not_required"
  | "pending_verification"
  | "photo"
  | "first_post"
  | "complete";

/**
 * Photo always comes first, then the first published post.
 *
 * Age/email verification remains enforced by DVNT's separate verification and
 * posting rails. It is intentionally not used to exempt legacy accounts from
 * these two profile requirements.
 */
export function determineNewMemberStep(input: OnboardingEvidence): OnboardingStep {
  if (!input.hasProfilePhoto) return "photo";
  if (!input.hasPost) return "first_post";
  return "complete";
}
