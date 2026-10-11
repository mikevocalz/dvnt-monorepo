import { resolveAdultVerificationState, type NormalizedVerification } from './verification-state.ts';

/** Legacy membership eligibility is separate from identity-provider verification. */
export async function resolveSpicyEligibility(db: any, userId: string | null | undefined, now = new Date()): Promise<NormalizedVerification> {
  const state = await resolveAdultVerificationState(db, userId, now);
  if (!userId || state.state === 'approved' || state.state === 'rejected' ||
      state.reason === 'verification_unavailable' || state.reason === 'account_changed') return state;
  try {
    const result = await db.rpc('legacy_adult_content_access', { p_auth_id: userId });
    if (!result.error && result.data === true) {
      return { state: 'approved', retryable: false, reason: 'legacy_membership',
        message: null, providerRef: null };
    }
  } catch { /* A missing/unreadable grant never admits an account. */ }
  return state;
}
