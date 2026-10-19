/** Coordinate the two independent browser sessions. No UI may claim success early. */
export function createAdminSignOut(deps: {
  clearLocalState: () => void
  payloadLogout: () => Promise<unknown>
  betterAuthSignOut: () => Promise<{ data?: { success?: boolean } | null; error?: unknown }>
  readPayloadUser: () => Promise<{ user: unknown | null }>
}) {
  let pending: Promise<void> | undefined
  return function signOutAdmin(): Promise<void> {
    if (pending) return pending
    pending = (async () => {
      let localCleanupFailed = false
      try { deps.clearLocalState() } catch { localCleanupFailed = true }
      // Remove SSO first: otherwise Payload's custom strategy can mask a local
      // JWT and its session id, clearing the cookie without revoking that session.
      let appSignOutFailed = false
      try {
        const result = await deps.betterAuthSignOut()
        appSignOutFailed = Boolean(result.error) || result.data?.success !== true
      } catch { appSignOutFailed = true }
      if (appSignOutFailed) {
        // Keep any local JWT cookie for retry. Under an active SSO strategy,
        // Payload could clear that cookie without identifying its session id.
        throw new Error('DVNT sign-out could not be confirmed. Please retry.')
      }
      // SSO-only/expired Payload sessions may return No User; verify below.
      try { await deps.payloadLogout() } catch { /* Verify the final state below. */ }
      // Handles an already-expired Payload session and partial-failure retries,
      // without treating arbitrary logout errors as successful revocation.
      const { user } = await deps.readPayloadUser()
      if (user !== null) throw new Error('The admin session has not been confirmed closed. Please retry sign-out.')
      if (localCleanupFailed) throw new Error('Browser cleanup could not be confirmed. Please retry sign-out.')
    })().finally(() => { pending = undefined })
    return pending
  }
}
