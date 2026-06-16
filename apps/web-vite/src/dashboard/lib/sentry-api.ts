/**
 * Sentry API Client for the DVNT Admin Dashboard
 *
 * Fetches data from Sentry's API to power the Sentry Health dashboard.
 * Requires a Sentry auth token with project:read and org:read scopes.
 *
 * Environment variables:
 *   VITE_SENTRY_ORG — Sentry organization slug
 *   VITE_SENTRY_PROJECT — Sentry project slug
 *   VITE_SENTRY_AUTH_TOKEN — Sentry API auth token (read-only)
 */

import type {
  SentryHealthOverview,
  CrashFreeMetrics,
  IssueSummary,
  FeatureHealthCard,
  ReleaseHealth,
  MessageButtonMetrics,
  DashboardFilters,
} from '@dvnt/observability/dashboard';

const SENTRY_BASE = 'https://sentry.io/api/0';

function getConfig() {
  const org = import.meta.env.VITE_SENTRY_ORG ?? '';
  const project = import.meta.env.VITE_SENTRY_PROJECT ?? '';
  const token = import.meta.env.VITE_SENTRY_AUTH_TOKEN ?? '';
  return { org, project, token };
}

async function sentryFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const { org, project, token } = getConfig();
  if (!org || !project || !token) {
    throw new Error('Sentry API not configured. Set VITE_SENTRY_ORG, VITE_SENTRY_PROJECT, and VITE_SENTRY_AUTH_TOKEN.');
  }

  const url = new URL(`${SENTRY_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Sentry API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// ─── Overview ────────────────────────────────────────────────────────────────

export async function fetchCrashFreeMetrics(period: '24h' | '7d' | '30d' = '24h'): Promise<CrashFreeMetrics> {
  const { org, project } = getConfig();
  const statsPeriod = period === '24h' ? '24h' : period === '7d' ? '7d' : '30d';

  const data = await sentryFetch<any>(
    `/organizations/${org}/sessions/`,
    {
      project: project,
      field: 'crash_free_sessions,crash_free_users,sum(session)',
      statsPeriod,
      groupBy: '',
    },
  );

  return {
    crashFreeSessions: data?.groups?.[0]?.totals?.['crash_free_sessions'] ?? 100,
    crashFreeUsers: data?.groups?.[0]?.totals?.['crash_free_users'] ?? 100,
    totalSessions: data?.groups?.[0]?.totals?.['sum(session)'] ?? 0,
    totalUsers: 0,
    period,
  };
}

export async function fetchUnresolvedIssues(query?: string): Promise<IssueSummary[]> {
  const { org, project } = getConfig();

  const params: Record<string, string> = {
    project: project,
    query: query ?? 'is:unresolved',
    sort: 'freq',
    limit: '25',
  };

  const data = await sentryFetch<any[]>(`/projects/${org}/${project}/issues/`, params);

  return (data ?? []).map((issue: any) => ({
    id: issue.id,
    title: issue.title,
    culprit: issue.culprit ?? '',
    level: issue.level ?? 'error',
    count: issue.count ?? 0,
    userCount: issue.userCount ?? 0,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    platform: issue.platform ?? 'unknown',
    project: issue.project?.slug ?? project,
    permalink: issue.permalink ?? '',
    shortId: issue.shortId ?? issue.id,
    metadata: issue.metadata,
  }));
}

// ─── Feature Health ──────────────────────────────────────────────────────────

export async function fetchFeatureHealth(featureArea: string, period: '24h' | '7d' | '30d' = '7d'): Promise<FeatureHealthCard> {
  const issues = await fetchUnresolvedIssues(`is:unresolved tag:featureArea:${featureArea}`);

  const errorCount = issues.reduce((sum, i) => sum + i.count, 0);
  const affectedUsers = issues.reduce((sum, i) => sum + i.userCount, 0);

  const displayNames: Record<string, string> = {
    auth: 'Auth Health',
    feed: 'Feed Health',
    messaging: 'Messaging Health',
    events: 'Events Health',
    stories: 'Stories Health',
    'sneaky-link': 'Sneaky Link Health',
    media: 'Media Upload Health',
    checkout: 'Checkout Health',
    blog: 'Blog/Payload Health',
    admin: 'Admin Dashboard Health',
    'trust-safety': 'Trust & Safety Health',
  };

  return {
    featureArea,
    displayName: displayNames[featureArea] ?? featureArea,
    errorCount,
    affectedUsers,
    latestIssue: issues[0],
    mostCommonRoute: issues[0]?.culprit,
    sentryIssueUrl: issues[0]?.permalink,
  };
}

export async function fetchAllFeatureHealth(period: '24h' | '7d' | '30d' = '7d'): Promise<FeatureHealthCard[]> {
  const areas = [
    'auth', 'feed', 'messaging', 'events', 'stories',
    'sneaky-link', 'media', 'checkout', 'blog', 'admin', 'trust-safety',
  ];

  const results = await Promise.allSettled(
    areas.map(area => fetchFeatureHealth(area, period))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<FeatureHealthCard> => r.status === 'fulfilled')
    .map(r => r.value);
}

// ─── Release Health ──────────────────────────────────────────────────────────

export async function fetchReleaseHealth(): Promise<ReleaseHealth[]> {
  const { org, project } = getConfig();

  const data = await sentryFetch<any[]>(
    `/organizations/${org}/releases/`,
    {
      project: project,
      per_page: '10',
      sort: 'date',
      healthStat: 'sessions',
    },
  );

  return (data ?? []).map((release: any) => ({
    version: release.version ?? '',
    crashFreeSessions: release.projects?.[0]?.healthData?.crashFreeSessions ?? 100,
    crashFreeUsers: release.projects?.[0]?.healthData?.crashFreeUsers ?? 100,
    newIssues: release.newGroups ?? 0,
    totalErrors: release.projects?.[0]?.healthData?.totalSessions ?? 0,
    adoptionRate: release.projects?.[0]?.healthData?.adoption ?? 0,
    platform: release.projects?.[0]?.platform ?? 'unknown',
    dateCreated: release.dateCreated ?? '',
  }));
}

// ─── Message Button Command Center ───────────────────────────────────────────

export async function fetchMessageButtonMetrics(period: '24h' | '7d' | '30d' = '7d'): Promise<MessageButtonMetrics> {
  const issues = await fetchUnresolvedIssues('is:unresolved tag:featureArea:messaging');

  const messageErrors = issues.filter((i: IssueSummary) =>
    i.title.toLowerCase().includes('message') ||
    i.culprit.toLowerCase().includes('message') ||
    i.culprit.toLowerCase().includes('inbox') ||
    i.culprit.toLowerCase().includes('dm')
  );

  const totalErrors = messageErrors.reduce((sum: number, i: IssueSummary) => sum + i.count, 0);
  const affectedUsers = messageErrors.reduce((sum: number, i: IssueSummary) => sum + i.userCount, 0);

  return {
    messageButtonTapCount: 0, // Comes from Supabase analytics
    messageButtonSuccessCount: 0, // Comes from Supabase analytics
    messageButtonFailureCount: totalErrors,
    messageOpenSuccessRate: totalErrors > 0 ? 0 : 100,
    inboxLoadFailureCount: messageErrors.filter((i: IssueSummary) => i.culprit.includes('inbox')).reduce((s: number, i: IssueSummary) => s + i.count, 0),
    spamLoadFailureCount: messageErrors.filter((i: IssueSummary) => i.culprit.includes('spam')).reduce((s: number, i: IssueSummary) => s + i.count, 0),
    dmThreadLoadFailureCount: messageErrors.filter((i: IssueSummary) => i.culprit.includes('thread')).reduce((s: number, i: IssueSummary) => s + i.count, 0),
    affectedUsersByMessageError: affectedUsers,
    errorsByRelease: [],
    errorsByDevice: [],
    errorsByOS: [],
    iosSpecificFailures: messageErrors.filter((i: IssueSummary) => i.platform === 'cocoa').reduce((s: number, i: IssueSummary) => s + i.count, 0),
    ipadSpecificFailures: 0,
    routeTransitionFailures: messageErrors.filter((i: IssueSummary) => i.culprit.includes('route')).reduce((s: number, i: IssueSummary) => s + i.count, 0),
    authSessionFailures: messageErrors.filter((i: IssueSummary) => i.culprit.includes('auth')).reduce((s: number, i: IssueSummary) => s + i.count, 0),
    latestErrors: messageErrors.slice(0, 10),
  };
}

// ─── Aggregated Overview ─────────────────────────────────────────────────────

export async function fetchSentryHealthOverview(filters: DashboardFilters): Promise<SentryHealthOverview> {
  const [crashFree, issues] = await Promise.all([
    fetchCrashFreeMetrics(filters.period),
    fetchUnresolvedIssues('is:unresolved'),
  ]);

  const critical = issues.filter((i: IssueSummary) => i.level === 'fatal' || i.level === 'error');

  return {
    crashFree,
    unresolvedCritical: critical.length,
    newIssues24h: 0, // Would need separate queries with date filters
    newIssues7d: 0,
    newIssues30d: issues.length,
    topAffectedScreens: [],
    topAffectedUsers: [],
    issuesByRelease: [],
    issuesByOTAUpdate: [],
    issuesByPlatform: [],
    slowestRoutes: [],
    failedApiCount: issues.filter((i: IssueSummary) => i.culprit.includes('api')).reduce((s: number, i: IssueSummary) => s + i.count, 0),
    messageButtonErrorCount: issues.filter((i: IssueSummary) =>
      i.title.includes('message') || i.culprit.includes('message')
    ).reduce((s: number, i: IssueSummary) => s + i.count, 0),
    mediaUploadFailureCount: issues.filter((i: IssueSummary) => i.culprit.includes('media')).reduce((s: number, i: IssueSummary) => s + i.count, 0),
    sneakyLinkFailureCount: issues.filter((i: IssueSummary) => i.culprit.includes('sneaky')).reduce((s: number, i: IssueSummary) => s + i.count, 0),
    checkoutFailureCount: issues.filter((i: IssueSummary) => i.culprit.includes('checkout')).reduce((s: number, i: IssueSummary) => s + i.count, 0),
    payloadBlogFailureCount: issues.filter((i: IssueSummary) => i.culprit.includes('payload') || i.culprit.includes('blog')).reduce((s: number, i: IssueSummary) => s + i.count, 0),
  };
}
