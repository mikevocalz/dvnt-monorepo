/**
 * Message Button Bug Command Center
 *
 * Dedicated section because of the App Store rejection.
 * Shows message button health, failure rates, device breakdown,
 * and links to Sentry issues/replays.
 */

import React, { useEffect, useState } from 'react';
import { fetchMessageButtonMetrics } from '../lib/sentry-api';
import type { MessageButtonMetrics, IssueSummary } from '@dvnt/observability/dashboard';

type Period = '24h' | '7d' | '30d';

export function MessageButtonCommandCenter() {
  const [period, setPeriod] = useState<Period>('7d');
  const [metrics, setMetrics] = useState<MessageButtonMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [period]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMessageButtonMetrics(period);
      setMetrics(data);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load message button metrics');
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <h3 className="text-red-400 font-semibold">Error Loading Command Center</h3>
          <p className="text-red-300/80 text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            📩 Message Button Command Center
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            App Store rejection tracking — Message button health monitoring
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
      ) : metrics ? (
        <>
          {/* Primary Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Button Failures" value={metrics.messageButtonFailureCount} danger />
            <StatCard label="Success Rate" value={`${metrics.messageOpenSuccessRate.toFixed(1)}%`} success={metrics.messageOpenSuccessRate >= 99} />
            <StatCard label="Affected Users" value={metrics.affectedUsersByMessageError} danger={metrics.affectedUsersByMessageError > 0} />
            <StatCard label="iOS Failures" value={metrics.iosSpecificFailures} danger={metrics.iosSpecificFailures > 0} />
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <BreakdownCard
              title="Inbox Load Failures"
              count={metrics.inboxLoadFailureCount}
            />
            <BreakdownCard
              title="Spam Query Failures"
              count={metrics.spamLoadFailureCount}
            />
            <BreakdownCard
              title="DM Thread Load Failures"
              count={metrics.dmThreadLoadFailureCount}
            />
            <BreakdownCard
              title="Route Transition Failures"
              count={metrics.routeTransitionFailures}
            />
            <BreakdownCard
              title="Auth/Session Failures"
              count={metrics.authSessionFailures}
            />
            <BreakdownCard
              title="iPad Specific"
              count={metrics.ipadSpecificFailures}
            />
          </div>

          {/* Latest Errors */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-3">Latest Message Flow Errors</h2>
            {metrics.latestErrors.length === 0 ? (
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
                <p className="text-green-400 text-sm font-medium">
                  ✓ No message flow errors in the selected period
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {metrics.latestErrors.map((issue: IssueSummary) => (
                  <div key={issue.id} className="rounded-lg border border-zinc-800 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{issue.title}</p>
                        <p className="text-zinc-500 text-xs mt-0.5">{issue.culprit}</p>
                        <div className="flex gap-3 mt-1.5 text-xs text-zinc-400">
                          <span>Count: {issue.count}</span>
                          <span>Users: {issue.userCount}</span>
                          <span>Platform: {issue.platform}</span>
                          <span>Last: {new Date(issue.lastSeen).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {issue.permalink && (
                          <a
                            href={issue.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 rounded bg-zinc-800 text-purple-400 hover:text-purple-300 text-xs"
                          >
                            Sentry
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Diagnostic Note */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <h3 className="text-zinc-300 text-sm font-medium">Diagnostic Context</h3>
            <ul className="mt-2 text-xs text-zinc-400 space-y-1">
              <li>• Tap counts (success/total) sourced from Supabase analytics_events</li>
              <li>• Failure data sourced from Sentry via featureArea:messaging tag</li>
              <li>• Look for auth/session failures before message opens (common rejection cause)</li>
              <li>• Check route transition failures on cold start and deep links</li>
              <li>• iPad-specific failures may indicate layout/navigation issues</li>
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, danger, success }: {
  label: string;
  value: number | string;
  danger?: boolean;
  success?: boolean;
}) {
  const borderColor = success ? 'border-green-500/30' : danger ? 'border-red-500/30' : 'border-zinc-800';
  const bgColor = success ? 'bg-green-500/5' : danger ? 'bg-red-500/5' : '';
  const textColor = success ? 'text-green-400' : danger ? 'text-red-400' : 'text-white';

  return (
    <div className={`rounded-lg border p-4 ${borderColor} ${bgColor}`}>
      <p className="text-zinc-400 text-xs uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${textColor}`}>{value}</p>
    </div>
  );
}

function BreakdownCard({ title, count }: { title: string; count: number }) {
  return (
    <div className={`rounded-lg border p-3 ${count > 0 ? 'border-red-500/20 bg-red-500/5' : 'border-zinc-800'}`}>
      <p className="text-zinc-400 text-xs">{title}</p>
      <p className={`text-xl font-bold mt-0.5 ${count > 0 ? 'text-red-400' : 'text-zinc-300'}`}>{count}</p>
    </div>
  );
}
