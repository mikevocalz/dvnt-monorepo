/** Native boot owns authStatus; web restores the persisted session flags instead. */
export function entitlementAuthState(input: {
  platform: string;
  authStatus: 'loading' | 'authenticated' | 'unauthenticated';
  hasHydrated: boolean;
  isAuthenticated: boolean;
  userId: string | null;
}) {
  const loading = input.platform === 'web' ? !input.hasHydrated : input.authStatus === 'loading';
  const signedIn = input.platform === 'web'
    ? input.hasHydrated && input.isAuthenticated && input.authStatus !== 'unauthenticated'
    : input.authStatus === 'authenticated';
  return { loading, enabled: signedIn && !!input.userId, identityError: signedIn && !input.userId };
}

/** A restored profile is only a query hint. Never resolve a plan through an anonymous client. */
export async function readAuthenticatedEntitlements<T>(input: {
  ensureAuthenticated: () => Promise<boolean>;
  isCurrentIdentity: () => boolean;
  read: () => Promise<T>;
}): Promise<T> {
  if (!input.isCurrentIdentity() || !await input.ensureAuthenticated() || !input.isCurrentIdentity()) {
    throw new Error('Could not verify subscription session. Please try again.');
  }
  const result = await input.read();
  if (!input.isCurrentIdentity()) throw new Error('Subscription identity changed. Please try again.');
  return result;
}
