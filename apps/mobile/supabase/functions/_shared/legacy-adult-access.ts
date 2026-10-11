import type { NormalizedVerification } from './verification-state.ts';

/** Resolve the separate server-owned legacy entitlement; never fabricate an ID pass. */
export async function applyLegacyAdultAccess(db: any, userId: string | null | undefined, state: NormalizedVerification): Promise<NormalizedVerification> {
  if (!userId || state.state === 'approved' || state.state === 'rejected' ||
      state.reason === 'verification_unavailable' || state.reason === 'account_changed') return state;
  try {
    const result = await db.rpc('legacy_adult_content_access', { p_auth_id: userId });
    if (!result.error && result.data === true) {
      return { state: 'approved', retryable: false, reason: 'legacy_membership',
        message: null, providerRef: null };
    }
  } catch { /* Missing/unreadable grants never admit an account. */ }
  return state;
}
