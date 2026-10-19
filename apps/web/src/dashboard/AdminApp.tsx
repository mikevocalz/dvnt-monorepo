'use client'
// src/dashboard/AdminApp.tsx — DVNT moderation console.
// Plain semantic HTML + CSS (ui.css). No react-native-web — robust, no
// SSR/white-panel issues. Client-only (auth + fetch). Same DVNT design family.
import { useEffect, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { adminQueryClient } from './lib/admin-session'
import { AdminSignOut } from './AdminSignOut'
import { payload, type Role } from './lib/payload'
import { RoleProvider, useRole } from './lib/role'
import { OverviewScreen } from './screens/OverviewScreen'
import { MembersScreen } from './screens/MembersScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { EventsScreen } from './screens/EventsScreen'
import { EventEditScreen } from './screens/EventEditScreen'
import { TeamScreen } from './screens/TeamScreen'
import { SentryHealthScreen } from './screens/SentryHealthScreen'
import { MessageButtonCommandCenter } from './screens/MessageButtonCommandCenter'
import './ui.css'

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
    <QueryClientProvider client={adminQueryClient}>
      <div className="dv">
        <div className="dv__wash" aria-hidden />
        <Gate />
      </div>
    </QueryClientProvider>
  )
}

function Gate() {
  const [state, setState] = useState<'loading' | 'in' | 'out' | 'signing-out'>('loading')
  const [role, setRole] = useState<Role>('moderator')
  useEffect(() => {
    let active = true
    payload
      .me()
      .then(({ user }) => {
        if (!active) return
        if (user) {
          setRole(user.role)
          setState(current => current === 'signing-out' ? current : 'in')
        } else setState(current => current === 'signing-out' ? current : 'out')
      })
      .catch(() => { if (active) setState(current => current === 'signing-out' ? current : 'out') })
    return () => { active = false }
  }, [])

  if (state === 'signing-out') return <AdminSignOut />
  if (state === 'loading')
    return <div className="dv-center"><span style={{ color: 'var(--dim)' }}>Loading…</span></div>
  if (state === 'out') return <Login />
  return (
    <RoleProvider role={role}>
      <Console onSignOut={() => setState('signing-out')} />
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
        {tab === 'health' && <HealthTab />}
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

function HealthTab() {
  const [sub, setSub] = useState<'app' | 'msgbtn'>('app')
  return (
    <>
      <div style={{ display: 'flex', gap: 4, padding: '12px 24px 0' }}>
        <button className={`dv-tab${sub === 'app' ? ' is-active' : ''}`} onClick={() => setSub('app')}>App health</button>
        <button className={`dv-tab${sub === 'msgbtn' ? ' is-active' : ''}`} onClick={() => setSub('msgbtn')}>Message button</button>
      </div>
      {sub === 'app' ? <SentryHealthScreen /> : <MessageButtonCommandCenter />}
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

function Login() {
  return (
    <div className="dv-center">
      <div className="dv-login">
        <img src="/dvnt-wordmark.svg" alt="DVNT" />
        <p className="dv-kicker">Admin · Moderation &amp; CMS</p>
        <p style={{ color: 'var(--dim)', fontSize: 14, lineHeight: 1.6 }}>
          Use your regular DVNT app account to manage members, events and blog posts.
          Admin permissions are verified after sign-in.
        </p>
        <a
          className="dv-btn dv-btn--primary"
          href="/auth/login?returnTo=%2Fadmin"
          style={{ display: 'block', padding: 12, textAlign: 'center', textDecoration: 'none' }}
        >
          Continue with DVNT
        </a>
        <a href="/admin/login?local=1" className="dv-link">
          Emergency legacy CMS sign-in
        </a>
      </div>
    </div>
  )
}
