'use client'
/**
 * /admin/observability — the A9 observability surface inside the Payload
 * admin. Reads the same server-side proxies the console uses
 * (/api/observability/*): the Sentry internal token never leaves the server.
 * Widgets deep-link to sentry.io for drill-down.
 */
import React, { useEffect, useState } from 'react'

const ORG = 'https://5th-galaxy-studios.sentry.io'

/* eslint-disable @typescript-eslint/no-explicit-any */

function Card({ title, children, href }: { title: string; children: React.ReactNode; href?: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--theme-elevation-150, #333)',
        borderRadius: 8,
        padding: 16,
        background: 'var(--theme-elevation-50, #1a1a1a)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{title}</h3>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
            Open in Sentry ↗
          </a>
        ) : null}
      </div>
      {children}
    </div>
  )
}

const Muted = ({ children }: { children: React.ReactNode }) => (
  <p style={{ margin: '4px 0', fontSize: 13, opacity: 0.7 }}>{children}</p>
)

export default function ObservabilityView() {
  const [probes, setProbes] = useState<any | null>(null)
  const [sessions, setSessions] = useState<any | null>(null)
  const [issues, setIssues] = useState<any[] | null>(null)
  const [monitors, setMonitors] = useState<any[] | null>(null)

  useEffect(() => {
    fetch('/api/observability/probes').then((r) => r.json()).then(setProbes).catch(() => {})
    fetch(
      '/api/observability/sentry?path=/organizations/5th-galaxy-studios/sessions/&project=-1&field=crash_free_rate(session)&field=sum(session)&statsPeriod=24h',
    )
      .then((r) => (r.ok ? r.json() : null))
      .then(setSessions)
      .catch(() => {})
    fetch('/api/observability/sentry?path=/projects/5th-galaxy-studios/dvnt-web/issues/&query=is:unresolved&sort=freq&limit=5')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setIssues(Array.isArray(d) ? d : []))
      .catch(() => setIssues([]))
    fetch('/api/observability/sentry?path=/organizations/5th-galaxy-studios/monitors/')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMonitors(Array.isArray(d) ? d : []))
      .catch(() => setMonitors([]))
  }, [])

  const crashFree = sessions?.groups?.[0]?.totals?.['crash_free_rate(session)']
  const totalSessions = sessions?.groups?.[0]?.totals?.['sum(session)']

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ marginTop: 0 }}>Observability</h1>
      <Muted>
        Live app health via the server-side Sentry proxy. Alert history lives in the{' '}
        <a href="/admin/collections/sentry-alerts">Sentry Alerts</a> collection.
      </Muted>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 16 }}>
        <Card title="Crash-free sessions (24h)" href={`${ORG}/insights/releases/`}>
          <p style={{ fontSize: 28, fontWeight: 800, margin: '4px 0' }}>
            {crashFree != null ? `${(crashFree * 100).toFixed(2)}%` : '—'}
          </p>
          <Muted>{totalSessions != null ? `${totalSessions} sessions` : 'Awaiting data'}</Muted>
        </Card>

        <Card title="Database" href={`${ORG}/crons/dvnt-edge/db-health/`}>
          <p style={{ fontSize: 28, fontWeight: 800, margin: '4px 0' }}>
            {probes?.db ? (probes.db.ok ? 'Healthy' : 'FAILING') : '—'}
          </p>
          <Muted>
            {probes?.db?.latencyMs != null ? `${probes.db.latencyMs}ms via PostgREST` : ''} · probed every minute ·
            dead-man monitored
          </Muted>
        </Card>

        <Card title="Bunny CDN" href={`${ORG}/crons/dvnt-edge/cdn-probe/`}>
          <p style={{ fontSize: 28, fontWeight: 800, margin: '4px 0' }}>
            {probes?.cdn ? (probes.cdn.ok ? 'Serving' : 'FAILING') : '—'}
          </p>
          <Muted>
            {probes?.cdn?.cdn
              ? `edge ${probes.cdn.cdn.latencyMs}ms (${probes.cdn.cdn.cacheStatus}) · origin ${probes.cdn.origin?.latencyMs ?? '—'}ms`
              : ''}
          </Muted>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 12, marginTop: 12 }}>
        <Card title="Top unresolved issues (dvnt-web)" href={`${ORG}/issues/?project=4511776642170880`}>
          {issues === null ? (
            <Muted>Loading…</Muted>
          ) : issues.length === 0 ? (
            <Muted>No unresolved issues. Enjoy it.</Muted>
          ) : (
            issues.map((i: any) => (
              <p key={i.id} style={{ margin: '6px 0', fontSize: 13 }}>
                <a href={i.permalink} target="_blank" rel="noopener noreferrer">
                  {i.shortId}
                </a>{' '}
                {String(i.title).slice(0, 80)} <span style={{ opacity: 0.6 }}>×{i.count}</span>
              </p>
            ))
          )}
        </Card>

        <Card title="Cron monitors" href={`${ORG}/crons/`}>
          {monitors === null ? (
            <Muted>Loading…</Muted>
          ) : (
            monitors.map((m: any) => (
              <p key={m.slug} style={{ margin: '6px 0', fontSize: 13 }}>
                {m.name} —{' '}
                <strong>
                  {m.environments?.[0]?.status ?? m.status ?? 'unknown'}
                </strong>
              </p>
            ))
          )}
        </Card>
      </div>
    </div>
  )
}
