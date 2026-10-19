/** @jsxImportSource react */
'use client'

import { useEffect, useState } from 'react'
import { signOutAdmin } from './lib/admin-session'

/** Shared by the console button and Payload's existing /admin/logout link. */
export function AdminSignOut() {
  const [error, setError] = useState(false)
  const run = async () => {
    setError(false)
    try {
      await signOutAdmin()
      // Discard Payload provider state and Next's authenticated router cache.
      window.location.replace('/auth/login?returnTo=%2Fadmin')
    } catch {
      setError(true)
    }
  }
  useEffect(() => { void run() }, [])
  return (
    <div role="status" style={{ padding: 32 }}>
      <h1>{error ? 'Sign-out could not be confirmed' : 'Signing out…'}</h1>
      {error && <>
        <p>Your session may still be active. Retry before leaving this browser.</p>
        <button type="button" onClick={() => { void run() }}>Retry sign-out</button>
      </>}
    </div>
  )
}
