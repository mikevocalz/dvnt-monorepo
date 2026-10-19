/** @jsxImportSource react */
'use client'

import { useEffect, useState } from 'react'
import { signOutAdmin } from './lib/admin-session'

/** Shared by the console button and Payload's existing /admin/logout link. */
export function AdminSignOut({ autoStart = false }: { autoStart?: boolean }) {
  const [started, setStarted] = useState(autoStart)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!started) return
    let active = true
    setError(false)
    void signOutAdmin().then(() => {
      if (!active) return
      // Discard Payload provider state and Next's authenticated router cache.
      window.location.replace('/auth/login?returnTo=%2Fadmin')
    }).catch(() => { if (active) setError(true) })
    // StrictMode/remount must not navigate from a stale success callback.
    return () => { active = false }
  }, [started, attempt])
  if (!started) return (
    <div style={{ padding: 32 }}>
      <h1>Sign out of DVNT?</h1>
      <p>This will sign you out of both DVNT and the admin editor.</p>
      <button type="button" onClick={() => setStarted(true)}>Sign out of DVNT</button>
    </div>
  )
  return (
    <div role="status" style={{ padding: 32 }}>
      <h1>{error ? 'Sign-out could not be confirmed' : 'Signing out…'}</h1>
      {error && <>
        <p>Your session may still be active. Retry before leaving this browser.</p>
        <button type="button" onClick={() => { setError(false); setAttempt(value => value + 1) }}>Retry sign-out</button>
      </>}
    </div>
  )
}
