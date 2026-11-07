/** Persisted profile data alone is not a signed-in session. */
export function authenticatedLynkAccount(state: {
  _hasHydrated?: boolean;
  isAuthenticated?: boolean;
  authStatus?: string;
  user?: { authId?: string | null; id?: string | null } | null;
}): string | null {
  if (!state._hasHydrated || !state.isAuthenticated || state.authStatus !== "authenticated") return null;
  return state.user?.authId || state.user?.id || null;
}
