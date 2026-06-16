// src/dashboard/widgets.tsx — small HTML widgets shared by the screens.
import { useState } from 'react'
import { useSetStatus } from './lib/hooks'
import { useRole } from './lib/role'
import { STATUS_COLOR } from './theme/tokens'

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? { bg: 'rgba(255,255,255,0.08)', fg: 'var(--dim)' }
  return (
    <span className="dv-badge" style={{ background: c.bg, color: c.fg }}>
      {status?.replace('_', ' ')}
    </span>
  )
}

export function Avatar({ uri, name }: { uri?: string; name?: string }) {
  if (uri) return <img className="dv-avatar" src={uri} alt="" loading="lazy" />
  return (
    <span className="dv-avatar dv-avatar--fallback">{(name ?? '?').slice(0, 2).toUpperCase()}</span>
  )
}

export function Pager({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="dv-pager">
      <span>{total.toLocaleString()} total</span>
      <div className="dv-pager__ctrls">
        <button className="dv-btn dv-btn--ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
        <span>{page} / {Math.max(1, totalPages)}</span>
        <button className="dv-btn dv-btn--ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  )
}

// One PATCH; server hooks fan out ban_list + audit + session revoke.
export function ModerationMenu({ member }: { member: any }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const setStatus = useSetStatus()
  const { canModerate } = useRole()
  if (!canModerate) return null

  const act = (status: string, days?: number) => {
    if ((status === 'banned' || status === 'suspended') && !reason.trim()) return
    const suspendedUntil = days ? new Date(Date.now() + days * 864e5).toISOString() : undefined
    setStatus.mutate({ id: member.id, status, reason: reason.trim() || undefined, suspendedUntil })
    setOpen(false)
    setReason('')
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="dv-btn" onClick={() => setOpen((o) => !o)}>Action ▾</button>
      {open && (
        <div className="dv-menu">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required to suspend/ban)" />
          <button className="dv-btn" onClick={() => act('under_review')}>Mark under review</button>
          <button className="dv-btn" onClick={() => act('warned')}>Warn</button>
          <button className="dv-btn" onClick={() => act('suspended', 7)}>Suspend 7 days</button>
          <button className="dv-btn" onClick={() => act('shadow_banned')}>Shadow ban</button>
          <button className="dv-btn dv-btn--primary" onClick={() => act('banned')}>Ban permanently</button>
          {member.status !== 'active' && <button className="dv-btn dv-btn--ghost" onClick={() => act('active')}>Reinstate</button>}
        </div>
      )}
    </div>
  )
}
