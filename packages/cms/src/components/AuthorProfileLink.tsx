/** @jsxImportSource react */
'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '@payloadcms/ui'

export async function loadOwnAuthorProfile() {
  const response = await fetch('/payload-api/authors/me/profile', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}',
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.errors?.[0]?.message || 'Could not open your author profile. Try again.')
  return result as { author: { id: number | string; name: string }; editURL: string }
}

export default function AuthorProfileLink() {
  const { user } = useAuth()
  const pending = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!user || !['super_admin', 'admin', 'moderator'].includes(user.role)) return null
  const open = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await loadOwnAuthorProfile()
      if (!alive.current) return
      window.location.assign(result.editURL)
    } catch (e) {
      if (!alive.current) return
      setError(e instanceof Error ? e.message : 'Could not open your author profile.')
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  return <div>
    <button type="button" className="btn btn--style-secondary btn--size-small" disabled={busy} onClick={open}>
      {busy ? 'Opening author profile…' : 'My author profile'}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>
}
