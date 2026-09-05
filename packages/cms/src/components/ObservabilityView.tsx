'use client'
/**
 * /admin/observability — the A9 observability surface inside the Payload
 * admin, in the DVNT design language (docs/design-language-audit.md):
 * eyebrow labels, 900-weight display, glass cards, gradient status strip on
 * the hero, emerald/rose semantics, cyan deep-links. Reads the same
 * server-side proxies as the Health tab — the Sentry token never reaches a
 * client bundle.
 */
import React, { useEffect, useState } from 'react'

const ORG = 'https://5th-galaxy-studios.sentry.io'

/* eslint-disable @typescript-eslint/no-explicit-any */

const T = {
  card: {
    position: 'relative' as const,
    overflow: 'hidden' as const,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 16,
    padding: 20,
    background: 'rgba(255,255,255,0.04)',
  },
  eyebrow: {
    margin: 0,
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: 3,
    textTransform: 'uppercase' as const,
    color: 'rgba(255,255,255,0.5)',
  },
  muted: { margin: '4px 0 0', fontSize: 13, lineHeight: 1.55, color: 'rgba(255,255,255,0.55)' },
  link: { color: '#3fdcff', fontSize: 12, textDecoration: 'none', fontWeight: 600 },
  pillOk: {
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background: 'rgba(52,211,153,0.14)',
    color: '#34d399',
  },
  pillBad: {
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background: 'rgba(251,113,133,0.14)',
    color: '#fb7185',
  },
}

function healthColor(pct: number): string {
  return pct >= 99.5 ? '#34d399' : pct >= 98 ? '#fbbf24' : '#fb7185'
}

function Card({
  title,
  children,
  href,
  strip,
}: {
  title: string
  children: React.ReactNode
  href?: string
  strip?: string
}) {
  return (
    <div style={T.card}>
      {strip ? (
        <span
          aria-hidden
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: strip }}
        />
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <p style={T.eyebrow}>{title}</p>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" style={T.link}>
            Open in Sentry ↗
          </a>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export default function ObservabilityView() {
  const [probes, setProbes] = useState<any | null>(null)
  const [sessions, setSessions] = useState<any | null>(null)
  const [issues, setIssues] = useState<any[] | null>(null)
  const [monitors, setMonitors] = useState<any[] | null>(null)

  useEffect(() => {
    fetch('/api/observability/probes').then((r) => r.json()).then(setProbes).catch(() => {})
    fetch(
      '/api/observability/sentry?path=/organizations/5th-galaxy-studios/sessions/&project=4511776642170880&field=crash_free_rate(session)&field=sum(session)&statsPeriod=24h',
    )
      .then((r) => (r.ok ? r.json() : null))
      .then(setSessions)
      .catch(() => {})
    fetch(
      '/api/observability/sentry?path=/projects/5th-galaxy-studios/dvnt-web/issues/&query=is:unresolved&sort=freq&limit=5',
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setIssues(Array.isArray(d) ? d : []))
      .catch(() => setIssues([]))
    fetch('/api/observability/sentry?path=/organizations/5th-galaxy-studios/monitors/')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMonitors(Array.isArray(d) ? d : []))
      .catch(() => setMonitors([]))
  }, [])

  const totals = sessions?.groups?.[0]?.totals ?? {}
  const rate = totals['crash_free_rate(session)']
  const crashFree = typeof rate === 'number' ? rate * 100 : null
  const totalSessions = totals['sum(session)']

  return (
    <div style={{ padding: 28, maxWidth: 1100, fontFamily: 'inherit' }}>
      <p style={T.eyebrow}>Observability</p>
      <h1 style={{ margin: '8px 0 0', fontSize: 30, fontWeight: 900, lineHeight: 1, color: '#fff' }}>
        App health
      </h1>
      <p style={{ ...T.muted, marginTop: 10 }}>
        Live from the server-side Sentry proxy. Alert history lives in{' '}
        <a href="/admin/collections/sentry-alerts" style={T.link}>
          Sentry Alerts
        </a>
        .
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 14,
          marginTop: 20,
        }}
      >
        <Card
          title="Crash-free sessions (24h)"
          href={`${ORG}/insights/releases/`}
          strip={
            crashFree === null || crashFree >= 99.5
              ? 'linear-gradient(90deg, #34A2DF, #8A40CF, #FF5BFC)'
              : '#fb7185'
          }
        >
          <p
            style={{
              margin: 0,
              fontSize: 44,
              fontWeight: 900,
              lineHeight: 1,
              color: crashFree === null ? 'rgba(255,255,255,0.4)' : healthColor(crashFree),
            }}
          >
            {crashFree === null ? '—' : `${crashFree.toFixed(2)}%`}
          </p>
          <p style={T.muted}>
            {totalSessions != null ? `${Number(totalSessions).toLocaleString()} sessions` : 'Awaiting data'}
          </p>
        </Card>

        <Card title="Database" href={`${ORG}/crons/dvnt-edge/db-health/`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={probes?.db?.ok ? T.pillOk : probes?.db ? T.pillBad : T.pillOk}>
              {probes?.db ? (probes.db.ok ? 'Healthy' : 'Failing') : '…'}
            </span>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>
              {probes?.db?.latencyMs != null ? `${probes.db.latencyMs}ms` : ''}
            </span>
          </div>
          <p style={T.muted}>PostgREST round-trip · probed every minute · dead-man monitored</p>
        </Card>

        <Card title="Bunny CDN" href={`${ORG}/crons/dvnt-edge/cdn-probe/`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={probes?.cdn?.ok ? T.pillOk : probes?.cdn ? T.pillBad : T.pillOk}>
              {probes?.cdn ? (probes.cdn.ok ? 'Serving' : 'Failing') : '…'}
            </span>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>
              {probes?.cdn?.cdn?.latencyMs != null ? `${probes.cdn.cdn.latencyMs}ms` : ''}
            </span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
              {probes?.cdn?.cdn?.cacheStatus ?? ''}
            </span>
          </div>
          <p style={T.muted}>
            Origin {probes?.cdn?.origin?.latencyMs != null ? `${probes.cdn.origin.latencyMs}ms` : '—'} ·
            canary every 5 min
          </p>
        </Card>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: 14,
          marginTop: 14,
        }}
      >
        <Card title="Top unresolved issues" href={`${ORG}/issues/?project=4511776642170880`}>
          {issues === null ? (
            <p style={T.muted}>Loading…</p>
          ) : issues.length === 0 ? (
            <p style={T.muted}>No unresolved issues. Enjoy it.</p>
          ) : (
            issues.map((i: any) => (
              <div
                key={i.id}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  padding: '8px 0',
                  borderTop: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <a href={i.permalink} target="_blank" rel="noopener noreferrer" style={T.link}>
                  {i.shortId}
                </a>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                    color: 'rgba(255,255,255,0.8)',
                  }}
                >
                  {String(i.title)}
                </span>
                <span
                  style={{
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.08)',
                    padding: '1px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'rgba(255,255,255,0.6)',
                  }}
                >
                  ×{i.count}
                </span>
              </div>
            ))
          )}
        </Card>

        <Card title="Cron monitors" href={`${ORG}/crons/`}>
          {monitors === null ? (
            <p style={T.muted}>Loading…</p>
          ) : (
            monitors.map((m: any) => {
              const status = m.environments?.[0]?.status ?? m.status ?? 'unknown'
              const ok = status === 'ok' || status === 'active'
              return (
                <div
                  key={m.slug}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderTop: '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{m.name}</span>
                  <span style={ok ? T.pillOk : T.pillBad}>{status}</span>
                </div>
              )
            })
          )}
        </Card>
      </div>
    </div>
  )
}
