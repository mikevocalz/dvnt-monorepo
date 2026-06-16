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
import { RECOMMENDED_ALERTS, type AlertRule } from '@dvnt/observability/dashboard';

type Period = '24h' | '7d' | '30d';

export function SentryHealthScreen() {
  const [period, setPeriod] = useState<Period>('7d');
  const [overview, setOverview] = useState<SentryHealthOverview | null>(null);
  const [features, setFeatures] = useState<FeatureHealthCard[]>([]);
  const [releases, setReleases] = useState<ReleaseHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          <p className="text-zinc-500 text-xs mt-2">
            Ensure VITE_SENTRY_ORG, VITE_SENTRY_PROJECT, and VITE_SENTRY_AUTH_TOKEN are set.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Sentry Health</h1>
          <p className="text-zinc-400 text-sm mt-1">
            App observability, crash tracking, and release health
          </p>
        </div>
        <div className="flex gap-2">
          {(['24h', '7d', '30d'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                period === p
                  ? 'bg-purple-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
        </div>
      ) : overview ? (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="Crash-Free Sessions"
              value={`${overview.crashFree.crashFreeSessions.toFixed(2)}%`}
              color={overview.crashFree.crashFreeSessions >= 99 ? 'green' : overview.crashFree.crashFreeSessions >= 95 ? 'yellow' : 'red'}
            />
            <MetricCard
              label="Crash-Free Users"
              value={`${overview.crashFree.crashFreeUsers.toFixed(2)}%`}
              color={overview.crashFree.crashFreeUsers >= 99 ? 'green' : overview.crashFree.crashFreeUsers >= 95 ? 'yellow' : 'red'}
            />
            <MetricCard
              label="Unresolved Critical"
              value={String(overview.unresolvedCritical)}
              color={overview.unresolvedCritical === 0 ? 'green' : overview.unresolvedCritical <= 5 ? 'yellow' : 'red'}
            />
            <MetricCard
              label="New Issues (period)"
              value={String(overview.newIssues30d)}
              color={overview.newIssues30d === 0 ? 'green' : 'yellow'}
            />
          </div>

          {/* Feature Error Counts */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MiniMetric label="Message Button" value={overview.messageButtonErrorCount} />
            <MiniMetric label="Media Upload" value={overview.mediaUploadFailureCount} />
            <MiniMetric label="Sneaky Link" value={overview.sneakyLinkFailureCount} />
            <MiniMetric label="Checkout" value={overview.checkoutFailureCount} />
            <MiniMetric label="Payload/Blog" value={overview.payloadBlogFailureCount} />
            <MiniMetric label="Failed APIs" value={overview.failedApiCount} />
          </div>

          {/* Feature Health Cards */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-3">Feature Health</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {features.map((f) => (
                <FeatureCard key={f.featureArea} card={f} />
              ))}
            </div>
          </div>

          {/* Release Health */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-3">Release Health</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="text-left py-2 px-3">Version</th>
                    <th className="text-left py-2 px-3">Crash-Free</th>
                    <th className="text-left py-2 px-3">New Issues</th>
                    <th className="text-left py-2 px-3">Adoption</th>
                    <th className="text-left py-2 px-3">Platform</th>
                    <th className="text-left py-2 px-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {releases.map((r) => (
                    <tr key={r.version} className="border-b border-zinc-800/50 text-zinc-300">
                      <td className="py-2 px-3 font-mono text-xs">{r.version}</td>
                      <td className="py-2 px-3">
                        <span className={r.crashFreeSessions >= 99 ? 'text-green-400' : r.crashFreeSessions >= 95 ? 'text-yellow-400' : 'text-red-400'}>
                          {r.crashFreeSessions.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2 px-3">{r.newIssues}</td>
                      <td className="py-2 px-3">{r.adoptionRate.toFixed(0)}%</td>
                      <td className="py-2 px-3">{r.platform}</td>
                      <td className="py-2 px-3 text-zinc-500">{new Date(r.dateCreated).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Alert Recommendations */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-3">Recommended Alerts</h2>
            <div className="space-y-2">
              {RECOMMENDED_ALERTS.map((alert) => (
                <div key={alert.name} className="rounded-lg border border-zinc-800 p-3 flex items-start gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    alert.priority === 'critical' ? 'bg-red-500/20 text-red-400' :
                    alert.priority === 'high' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-blue-500/20 text-blue-400'
                  }`}>
                    {alert.priority}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{alert.name}</p>
                    <p className="text-zinc-400 text-xs mt-0.5">{alert.description}</p>
                    <p className="text-zinc-500 text-xs mt-1">Threshold: {alert.threshold}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MetricCard({ label, value, color }: { label: string; value: string; color: 'green' | 'yellow' | 'red' }) {
  const colorClasses = {
    green: 'border-green-500/30 bg-green-500/5',
    yellow: 'border-yellow-500/30 bg-yellow-500/5',
    red: 'border-red-500/30 bg-red-500/5',
  };
  const textClasses = {
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-zinc-400 text-xs uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${textClasses[color]}`}>{value}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-3 text-center">
      <p className="text-zinc-500 text-xs">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${value === 0 ? 'text-zinc-400' : 'text-red-400'}`}>
        {value}
      </p>
    </div>
  );
}

function FeatureCard({ card }: { card: FeatureHealthCard }) {
  const healthy = card.errorCount === 0;

  return (
    <div className={`rounded-lg border p-4 ${healthy ? 'border-zinc-800' : 'border-red-500/20 bg-red-500/5'}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-white font-medium text-sm">{card.displayName}</h3>
        <span className={`w-2 h-2 rounded-full ${healthy ? 'bg-green-400' : 'bg-red-400'}`} />
      </div>
      <div className="mt-2 space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Errors</span>
          <span className={healthy ? 'text-zinc-300' : 'text-red-400'}>{card.errorCount}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Affected Users</span>
          <span className="text-zinc-300">{card.affectedUsers}</span>
        </div>
        {card.latestIssue && (
          <div className="mt-2 pt-2 border-t border-zinc-800">
            <p className="text-xs text-zinc-400 truncate">{card.latestIssue.title}</p>
            {card.sentryIssueUrl && (
              <a
                href={card.sentryIssueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-purple-400 hover:text-purple-300 mt-1 inline-block"
              >
                View in Sentry →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
