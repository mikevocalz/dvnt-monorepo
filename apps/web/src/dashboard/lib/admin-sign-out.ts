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
      // Payload needs the current identity, including SSO-only users, so do it
      // before removing Better Auth. Still attempt Better Auth if this fails.
      try { await deps.payloadLogout() } catch { /* Verify the final state below. */ }
      const result = await deps.betterAuthSignOut()
      if (result.error || result.data?.success !== true) {
        throw new Error('DVNT sign-out could not be confirmed. Please retry.')
      }
      // Handles an already-expired Payload session and partial-failure retries,
      // without treating arbitrary logout errors as successful revocation.
      const { user } = await deps.readPayloadUser()
      if (user !== null) throw new Error('The admin session has not been confirmed closed. Please retry sign-out.')
      if (localCleanupFailed) throw new Error('Browser cleanup could not be confirmed. Please retry sign-out.')
    })().finally(() => { pending = undefined })
    return pending
  }
}
