/**
 * Mandatory DVNT entry steps for every member account.
 *
 * The old flow applied photo + first-post only to accounts created after a
 * rollout cutoff. Existing accounts are no longer exempt: everybody must have
 * both pieces of server-proven evidence.
 *
 * The cutoff is still used for one purpose only: accounts created after the
 * 18+ onboarding rollout must finish email/adult verification before they can
 * enter the photo -> first-post sequence. Legacy accounts keep their existing
 * age-access treatment while gaining the two new profile requirements.
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
 * New signups preserve DVNT's verification-first ordering. After that, and for
 * every legacy account, photo always comes first and first post second.
 */
export function determineNewMemberStep(input: OnboardingEvidence): OnboardingStep {
  const created = Date.parse(String(input.accountCreatedAt ?? ""));
  const isVerificationEraAccount =
    Number.isFinite(created) && created >= Date.parse(NEW_MEMBER_ONBOARDING_CUTOFF);

  if (isVerificationEraAccount && (!input.emailVerified || !input.adultVerified)) {
    return "pending_verification";
  }
  if (!input.hasProfilePhoto) return "photo";
  if (!input.hasPost) return "first_post";
  return "complete";
}
