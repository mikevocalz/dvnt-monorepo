/** @jsxImportSource react */
'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useField } from '@payloadcms/ui'
import { loadOwnAuthorProfile } from './AuthorProfileLink'

// Creating/linking a profile does not rewrite any existing article. This
// explicit action changes the native authors field; Payload retains ownership
// of autosave, Save Draft / Publish, validation and document locking.
export default function PostAuthorProfile() {
  const { setValue } = useField<Array<string | number>>({ path: 'authors' })
  const pending = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState<{ editURL: string; name: string } | null>(null)
  const setMe = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await loadOwnAuthorProfile()
      if (!alive.current) return
      setValue([result.author.id])
      setProfile({ editURL: result.editURL, name: result.author.name })
    } catch (e) {
      if (!alive.current) return
      setError(e instanceof Error ? e.message : 'Could not set your byline.')
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  return <div style={{ marginBottom: '1rem' }}>
    <button type="button" className="btn btn--style-secondary btn--size-small" disabled={busy} onClick={setMe}>
      {busy ? 'Loading your profile…' : 'Set me as author'}
    </button>
    <p>Replaces the primary byline with your account-linked profile. Save Draft or Publish applies your change.</p>
    {profile && <p role="status">By {profile.name}. <a href={profile.editURL} target="_blank" rel="noopener noreferrer">Edit author profile</a></p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
