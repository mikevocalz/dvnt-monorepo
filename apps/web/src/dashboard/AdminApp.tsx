'use client'
// src/dashboard/AdminApp.tsx — DVNT moderation console.
// Plain semantic HTML + CSS (ui.css). No react-native-web — robust, no
// SSR/white-panel issues. Client-only (auth + fetch). Same DVNT design family.
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { payload, type Role } from './lib/payload'
import { RoleProvider, useRole } from './lib/role'
import { OverviewScreen } from './screens/OverviewScreen'
import { MembersScreen } from './screens/MembersScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { EventsScreen } from './screens/EventsScreen'
import { EventEditScreen } from './screens/EventEditScreen'
import { TeamScreen } from './screens/TeamScreen'
import { SentryHealthScreen } from './screens/SentryHealthScreen'
import './ui.css'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

const BASE_TABS: [string, string][] = [
  ['overview', 'Overview'],
  ['members', 'Members'],
  ['events', 'Events'],
  ['reports', 'Reports'],
  ['health', 'Health'],
]
// Granting console roles is super-admin only, so the Team tab is too.
const TEAM_TAB: [string, string] = ['team', 'Team']
// The Payload CMS (/admin) is the RECORDS backend — content + raw data,
// grouped there as Content / App mirror / Moderation / Observability / Access.
// The console is where daily work happens; these links jump to the records.
const CMS_LINKS: [string, string][] = [
  ['Posts', '/admin/collections/posts'],
  ['Comments', '/admin/collections/comments'],
  ['Media', '/admin/collections/media'],
  ['All records →', '/admin'],
]

export function AdminApp() {
  return (
    <QueryClientProvider client={qc}>
      <div className="dv">
        <div className="dv__wash" aria-hidden />
        <Gate />
      </div>
    </QueryClientProvider>
  )
}

function Gate() {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading')
  const [role, setRole] = useState<Role>('moderator')
  useEffect(() => {
    payload
      .me()
      .then(({ user }) => {
        if (user) {
          setRole(user.role)
          setState('in')
        } else setState('out')
      })
      .catch(() => setState('out'))
  }, [])

  const signOut = async () => {
    await payload.logout().catch(() => {})
    setState('out')
  }

  if (state === 'loading')
    return <div className="dv-center"><span style={{ color: 'var(--dim)' }}>Loading…</span></div>
  if (state === 'out') return <Login onIn={(r) => { setRole(r); setState('in') }} />
  return (
    <RoleProvider role={role}>
      <Console onSignOut={signOut} />
    </RoleProvider>
  )
}

function Console({ onSignOut }: { onSignOut: () => void }) {
  const { isSuperAdmin } = useRole()
  const tabs: [string, string][] = isSuperAdmin ? [...BASE_TABS, TEAM_TAB] : BASE_TABS
  const [tab, setTab] = useState('overview')
  const [editEventId, setEditEventId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const go = (k: string) => { setTab(k); setEditEventId(null) }

  return (
    <>
      <Header tabs={tabs} active={tab} onNav={go} onSignOut={onSignOut} onOpenMenu={() => setMenuOpen(true)} />
      <main className="dv-body">
        {tab === 'overview' && <OverviewScreen />}
        {tab === 'members' && <MembersScreen />}
        {tab === 'reports' && <ReportsScreen />}
        {tab === 'health' && <SentryHealthScreen />}
        {tab === 'team' && isSuperAdmin && <TeamScreen />}
        {tab === 'events' &&
          (editEventId ? (
            <EventEditScreen eventId={editEventId} onClose={() => setEditEventId(null)} />
          ) : (
            <EventsScreen onEdit={(id) => setEditEventId(id)} />
          ))}
      </main>
      {/* Drawer lives OUTSIDE the header: .dv-header has backdrop-filter, which
          creates a stacking context AND a containing block for fixed children —
          nesting the drawer there trapped it under the page content. As a direct
          child of .dv it overlays everything (z-index 300) and CSS vars resolve. */}
      {menuOpen && (
        <Drawer
          tabs={tabs}
          active={tab}
          onClose={() => setMenuOpen(false)}
          onNav={(k) => { go(k); setMenuOpen(false) }}
          onSignOut={() => { onSignOut(); setMenuOpen(false) }}
        />
      )}
    </>
  )
}

function Header({ tabs, active, onNav, onSignOut, onOpenMenu }: { tabs: [string, string][]; active: string; onNav: (k: string) => void; onSignOut: () => void; onOpenMenu: () => void }) {
  return (
    <header className="dv-header">
      <nav className="dv-nav">
        <a href="/" className="dv-logo">
          <img src="/dvnt-wordmark.svg" alt="DVNT" />
          <span>Admin</span>
        </a>
        <div className="dv-tabs">
          {tabs.map(([k, label]) => (
            <button key={k} className={`dv-tab${active === k ? ' is-active' : ''}`} onClick={() => onNav(k)}>
              {label}
            </button>
          ))}
          <span className="dv-divider" />
          <span className="dv-cmslabel">Records</span>
          {CMS_LINKS.map(([label, href]) => (
            <a key={label} href={href} className="dv-cmslink">{label}</a>
          ))}
        </div>
        <span className="dv-spacer" />
        <button className="dv-signout" onClick={onSignOut}>Sign out</button>
        <button className="dv-burger" aria-label="Open menu" onClick={onOpenMenu}>
          <span /><span /><span />
        </button>
      </nav>
    </header>
  )
}

function Drawer({ tabs, active, onClose, onNav, onSignOut }: { tabs: [string, string][]; active: string; onClose: () => void; onNav: (k: string) => void; onSignOut: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="dv-drawer">
      <button className="dv-scrim" aria-label="Close menu" onClick={onClose} />
      <aside className="dv-panel" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="dv-panel__head">
          <img src="/dvnt-wordmark.svg" alt="DVNT" />
          <button className="dv-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <nav>
          {tabs.map(([k, label], i) => (
            <button key={k} className={`dv-drawer__link${active === k ? ' is-active' : ''}`} onClick={() => onNav(k)}>
              <span className="dv-drawer__idx">0{i + 1}</span>
              <span className="dv-drawer__label">{label}</span>
            </button>
          ))}
        </nav>
        <p className="dv-drawer__section">Records (CMS)</p>
        {CMS_LINKS.map(([label, href]) => (
          <a key={label} href={href} className="dv-drawer__cms">{label}</a>
        ))}
        <span className="dv-spacer" />
        <button className="dv-drawer__signout" onClick={onSignOut}>Sign out</button>
        <span className="dv-tagline">connect. gather. move.</span>
      </aside>
    </div>
  )
}

function Login({ onIn }: { onIn: (role: Role) => void }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await payload.login(email, pw)
      const { user } = await payload.me()
      if (user) onIn(user.role)
      else setErr('Login failed.')
    } catch {
      setErr('Invalid credentials.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="dv-center">
      <form className="dv-login" onSubmit={submit}>
        <img src="/dvnt-wordmark.svg" alt="DVNT" />
        <p className="dv-kicker">Admin · Moderation &amp; CMS</p>
        <input className="dv-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="dv-input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {!!err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
        <button className="dv-btn dv-btn--primary" type="submit" disabled={busy} style={{ padding: '10px' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <a href="/admin" className="dv-link">Open the Payload CMS →</a>
      </form>
    </div>
  )
}
