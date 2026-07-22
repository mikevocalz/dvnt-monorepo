/**
 * Sentry Health Dashboard Screen
 *
 * Admin-only view showing app health, crash-free metrics, feature health cards,
 * release health, and quick links to Sentry issues.
 */

import React, { useEffect, useState } from 'react';
import {
  fetchSentryHealthOverview,
  fetchAllFeatureHealth,
  fetchReleaseHealth,
} from '../lib/sentry-api';
import type {
  SentryHealthOverview,
  FeatureHealthCard,
  ReleaseHealth,
  DashboardFilters,
} from '@dvnt/observability/dashboard';

type Period = '24h' | '7d' | '30d';

export function SentryHealthScreen() {
  const [period, setPeriod] = useState<Period>('7d');
  const [overview, setOverview] = useState<SentryHealthOverview | null>(null);
  const [features, setFeatures] = useState<FeatureHealthCard[]>([]);
  const [releases, setReleases] = useState<ReleaseHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A10 cards: DB + CDN probe status via the public probe fan-out (no token).
  const [probes, setProbes] = useState<any | null>(null);

  useEffect(() => {
    fetch('/api/observability/probes')
      .then((r) => r.json())
      .then(setProbes)
      .catch(() => setProbes(null));
  }, []);

  useEffect(() => {
    loadData();
  }, [period]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: DashboardFilters = { period };
      const [overviewData, featureData, releaseData] = await Promise.all([
        fetchSentryHealthOverview(filters),
        fetchAllFeatureHealth(period),
        fetchReleaseHealth(),
      ]);
      setOverview(overviewData);
      setFeatures(featureData);
      setReleases(releaseData);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load Sentry health data');
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <h3 className="text-red-400 font-semibold">Sentry API Error</h3>
          <p className="text-red-300/80 text-sm mt-1">{error}</p>
          {error?.includes('not configured') ? (
            <p className="text-white/50 text-xs mt-2">
              Set SENTRY_INTERNAL_TOKEN in the server env (never NEXT_PUBLIC_) — the dashboard reads Sentry through the /api/observability proxy.
            </p>
          ) : (
            <button
              onClick={() => loadData()}
              className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] p-6 space-y-8">
      {/* Header — eyebrow + display, period pills right */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[3px] text-white/50">
            Observability
          </p>
          <h1 className="mt-2 text-[30px] font-black leading-none text-white">App health</h1>
          <p className="mt-2 text-sm text-white/55">
            Crashes, slow spots, and release health — live from Sentry.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
          {(['24h', '7d', '30d'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                period === p
                  ? 'bg-[rgb(62,164,229)] text-white'
                  : 'text-white/55 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-[#3fdcff]" />
        </div>
      ) : overview ? (
        <>
          {/* Hero + infra — the page thesis: are we healthy right now? */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <HeroCrashFree crashFree={overview.crashFree} critical={overview.unresolvedCritical} />
            <InfraCards probes={probes} />
          </div>

          {/* Signals — only surfaces that are actually erroring */}
          <SignalStrip overview={overview} />

          {/* Feature health — errors first, healthy stays quiet */}
          <section>
            <p className="mb-3 text-[11px] font-black uppercase tracking-[3px] text-white/50">
              Feature health
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {[...features]
                .sort((a, b) => b.errorCount - a.errorCount)
                .map((f) => (
                  <FeatureCard key={f.featureArea} card={f} />
                ))}
            </div>
          </section>

          {/* Releases */}
          <section>
            <p className="mb-3 text-[11px] font-black uppercase tracking-[3px] text-white/50">
              Release health
            </p>
            <div className="overflow-x-auto rounded-2xl border border-white/12 bg-white/[0.04]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[11px] font-bold uppercase tracking-wider text-white/45">
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Crash-free</th>
                    <th className="px-4 py-3">New issues</th>
                    <th className="px-4 py-3">Adoption</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {releases.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-white/50">
                        No releases yet — releases appear after the next tagged deploy.
                      </td>
                    </tr>
                  ) : (
                    releases.map((r) => (
                      <tr key={r.version} className="border-b border-white/[0.06] text-white/80 last:border-0">
                        <td className="px-4 py-3 font-mono text-xs">{r.version}</td>
                        <td className="px-4 py-3">
                          <span className={healthColor(r.crashFreeSessions)}>
                            {r.crashFreeSessions.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3">{r.newIssues}</td>
                        <td className="px-4 py-3">{r.adoptionRate.toFixed(0)}%</td>
                        <td className="px-4 py-3 text-white/50">
                          {new Date(r.dateCreated).toLocaleDateString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function healthColor(pct: number): string {
  return pct >= 99.5 ? 'text-emerald-400' : pct >= 98 ? 'text-amber-400' : 'text-rose-400';
}

/** The page thesis: one giant crash-free number under a gradient status strip. */
function HeroCrashFree({
  crashFree,
  critical,
}: {
  crashFree: SentryHealthOverview['crashFree'];
  critical: number;
}) {
  const pct = crashFree.crashFreeSessions;
  const ok = pct >= 99.5;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-white/[0.04]">
      {/* Status strip — brand gradient when healthy, rose when not. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{
          background: ok
            ? 'linear-gradient(90deg, #34A2DF, #8A40CF, #FF5BFC)'
            : '#fb7185',
        }}
      />
      <div className="p-5">
        <p className="text-[11px] font-black uppercase tracking-[3px] text-white/50">
          Crash-free sessions
        </p>
        <p className={`mt-2 text-[52px] font-black leading-none ${healthColor(pct)}`}>
          {pct.toFixed(2)}%
        </p>
        <p className="mt-3 text-sm text-white/55">
          {crashFree.totalSessions.toLocaleString()} sessions · users{' '}
          <span className={healthColor(crashFree.crashFreeUsers)}>
            {crashFree.crashFreeUsers.toFixed(1)}%
          </span>{' '}
          crash-free
        </p>
        <p className="mt-1 text-sm text-white/55">
          {critical === 0 ? (
            <span className="text-emerald-400">No unresolved critical issues</span>
          ) : (
            <span className="text-rose-400">{critical} unresolved critical</span>
          )}
        </p>
      </div>
    </div>
  );
}

/** Only surfaces that are erroring get a chip — silence stays silent. */
function SignalStrip({ overview }: { overview: SentryHealthOverview }) {
  const signals: [string, number][] = [
    ['Message button', overview.messageButtonErrorCount],
    ['Media upload', overview.mediaUploadFailureCount],
    ['Sneaky Lynk', overview.sneakyLinkFailureCount],
    ['Checkout', overview.checkoutFailureCount],
    ['Payload/Blog', overview.payloadBlogFailureCount],
    ['API failures', overview.failedApiCount],
  ];
  const firing = signals.filter(([, n]) => n > 0);
  if (firing.length === 0)
    return (
      <p className="text-sm text-white/45">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" />
        All feature signals quiet.
      </p>
    );
  return (
    <div className="flex flex-wrap gap-2">
      {firing.map(([label, n]) => (
        <span
          key={label}
          className="flex items-center gap-2 rounded-full border border-rose-400/25 bg-rose-400/10 px-3.5 py-1.5 text-sm font-semibold text-rose-300"
        >
          {label}
          <span className="rounded-full bg-rose-400/20 px-2 text-xs font-bold">{n}</span>
        </span>
      ))}
    </div>
  );
}

function FeatureCard({ card }: { card: FeatureHealthCard }) {
  const healthy = card.errorCount === 0;
  return (
    <div
      className={`rounded-2xl border p-4 ${
        healthy
          ? 'border-white/10 bg-white/[0.03]'
          : 'border-rose-400/25 bg-rose-400/[0.06]'
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{card.displayName}</h3>
        <span className={`h-2 w-2 rounded-full ${healthy ? 'bg-emerald-400' : 'bg-rose-400'}`} />
      </div>
      {healthy ? (
        <p className="mt-2 text-xs text-white/45">No errors</p>
      ) : (
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-white/55">Errors</span>
            <span className="font-semibold text-rose-300">{card.errorCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/55">Affected users</span>
            <span className="text-white/80">{card.affectedUsers}</span>
          </div>
          {card.latestIssue ? (
            <div className="mt-2 border-t border-white/10 pt-2">
              <p className="truncate text-white/60">{card.latestIssue.title}</p>
              {card.sentryIssueUrl ? (
                <a
                  href={card.sentryIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-[#3fdcff] hover:text-white"
                >
                  Open in Sentry ↗
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function InfraCards({ probes }: { probes: any | null }) {
  const db = probes?.db;
  const cdn = probes?.cdn;
  const pill = (ok: boolean | undefined) =>
    ok === undefined
      ? 'bg-white/15 text-white/75'
      : ok
        ? 'bg-emerald-500/15 text-emerald-400'
        : 'bg-red-500/15 text-red-400';
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold">Database</h3>
          <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pill(db?.ok)}`}>
            {db === undefined ? '…' : db?.ok ? 'Healthy' : 'Failing'}
          </span>
        </div>
        <p className="text-white/60 text-sm mt-2">
          PostgREST round-trip {db?.latencyMs != null ? `${db.latencyMs}ms` : '—'} · probed every
          minute · dead-man cron monitor <span className="text-white/75">db-health</span>
        </p>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold">Bunny CDN</h3>
          <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pill(cdn?.ok)}`}>
            {cdn === undefined ? '…' : cdn?.ok ? 'Serving' : 'Failing'}
          </span>
        </div>
        <p className="text-white/60 text-sm mt-2">
          Edge {cdn?.cdn?.latencyMs != null ? `${cdn.cdn.latencyMs}ms` : '—'} (
          {cdn?.cdn?.cacheStatus ?? '—'}) · origin{' '}
          {cdn?.origin?.latencyMs != null ? `${cdn.origin.latencyMs}ms` : '—'} · canary probed
          every 5 min · monitor <span className="text-white/75">cdn-probe</span>
        </p>
      </div>
    </div>
  );
}
