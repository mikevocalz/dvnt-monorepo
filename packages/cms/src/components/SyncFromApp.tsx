/** @jsxImportSource react */
'use client'
// beforeDashboard card: pull live app data (Supabase public.events / public.users)
// into Payload's own `events` / `members` collections so the CMS lists are
// populated. super_admin only (the endpoint enforces it); the button just calls
// POST /api/app/sync and reports the upsert counts.
import React, { useState } from 'react'

type Count = { created: number; updated: number; total: number }
type Result = {
  ok?: boolean
  members?: Count
  events?: Count
  tickets?: Count
  errors?: { message: string }[]
}

export default function SyncFromApp() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const run = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/payload-api/app/sync', { method: 'POST', credentials: 'include' })
      setResult(await res.json())
    } catch (e: any) {
      setResult({ errors: [{ message: e?.message ?? 'Sync failed' }] })
    } finally {
      setBusy(false)
    }
  }

  const err = result?.errors?.[0]?.message
  return (
    <div className="dvnt-sync">
      <div className="dvnt-sync__text">
        <strong>Live app data</strong>
        <span>Pull events, members &amp; tickets from the app into the CMS collections.</span>
      </div>
      <div className="dvnt-sync__action">
        <button type="button" className="btn btn--style-primary btn--size-medium" onClick={run} disabled={busy}>
          {busy ? 'Syncing…' : 'Sync from app'}
        </button>
        {result?.ok && (
          <span className="dvnt-sync__msg dvnt-sync__msg--ok">
            Members {result.members?.total} ({result.members?.created} new) · Events {result.events?.total} ({result.events?.created} new) · Tickets {result.tickets?.total} ({result.tickets?.created} new)
          </span>
        )}
        {err && <span className="dvnt-sync__msg dvnt-sync__msg--err">{err}</span>}
      </div>
    </div>
  )
}
