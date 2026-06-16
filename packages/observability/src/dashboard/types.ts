/**
 * @dvnt/observability — Dashboard types for the Sentry Health admin view
 *
 * These types model the data rendered in the vite-web admin Sentry Health section.
 * The actual Sentry API calls happen in vite-web; these types are shared.
 */

export interface CrashFreeMetrics {
  crashFreeSessions: number; // percentage 0-100
  crashFreeUsers: number;    // percentage 0-100
  totalSessions: number;
  totalUsers: number;
  period: '24h' | '7d' | '30d';
}

export interface IssueSummary {
  id: string;
  title: string;
  culprit: string;
  level: 'fatal' | 'error' | 'warning' | 'info';
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  platform: string;
  project: string;
  permalink: string;
  shortId: string;
  metadata?: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  tags?: Array<{ key: string; value: string; count: number }>;
}

export interface FeatureHealthCard {
  featureArea: string;
  displayName: string;
  errorCount: number;
  affectedUsers: number;
  latestIssue?: IssueSummary;
  mostCommonRoute?: string;
  slowestTransaction?: { name: string; p95Ms: number };
  releaseIntroduced?: string;
  sentryIssueUrl?: string;
  replayUrl?: string;
}

export interface ReleaseHealth {
  version: string;
  buildNumber?: string;
  expoUpdateId?: string;
  crashFreeSessions: number;
  crashFreeUsers: number;
  newIssues: number;
  totalErrors: number;
  adoptionRate: number;
  platform: string;
  dateCreated: string;
}

export interface MessageButtonMetrics {
  messageButtonTapCount: number;
  messageButtonSuccessCount: number;
  messageButtonFailureCount: number;
  messageOpenSuccessRate: number;
  inboxLoadFailureCount: number;
  spamLoadFailureCount: number;
  dmThreadLoadFailureCount: number;
  affectedUsersByMessageError: number;
  errorsByRelease: Array<{ release: string; count: number }>;
  errorsByDevice: Array<{ device: string; count: number }>;
  errorsByOS: Array<{ os: string; count: number }>;
  iosSpecificFailures: number;
  ipadSpecificFailures: number;
  routeTransitionFailures: number;
  authSessionFailures: number;
  latestErrors: IssueSummary[];
}

export interface SentryHealthOverview {
  crashFree: CrashFreeMetrics;
  unresolvedCritical: number;
  newIssues24h: number;
  newIssues7d: number;
  newIssues30d: number;
  topAffectedScreens: Array<{ screen: string; errorCount: number }>;
  topAffectedUsers: Array<{ userId: string; username?: string; errorCount: number }>;
  issuesByRelease: Array<{ release: string; count: number }>;
  issuesByOTAUpdate: Array<{ updateId: string; count: number }>;
  issuesByPlatform: Array<{ platform: string; count: number }>;
  slowestRoutes: Array<{ route: string; p95Ms: number }>;
  failedApiCount: number;
  messageButtonErrorCount: number;
  mediaUploadFailureCount: number;
  sneakyLinkFailureCount: number;
  checkoutFailureCount: number;
  payloadBlogFailureCount: number;
}

export interface DashboardFilters {
  release?: string;
  buildNumber?: string;
  expoUpdateId?: string;
  channel?: string;
  platform?: 'ios' | 'android' | 'web';
  osVersion?: string;
  device?: string;
  featureArea?: string;
  period: '24h' | '7d' | '30d';
}

// ─── Alert Rule Recommendations ──────────────────────────────────────────────

export interface AlertRule {
  name: string;
  description: string;
  conditions: string;
  threshold: string;
  action: string;
  priority: 'critical' | 'high' | 'medium';
}

export const RECOMMENDED_ALERTS: AlertRule[] = [
  {
    name: 'Crash spike after OTA',
    description: 'New crashes spike within 30 min of an OTA update',
    conditions: 'tag:expoUpdateId changed AND error count > 10 in 30m',
    threshold: '10 errors in 30 minutes',
    action: 'Page on-call, consider rolling back OTA',
    priority: 'critical',
  },
  {
    name: 'Message button errors above threshold',
    description: 'Message button flow failures exceed acceptable rate',
    conditions: 'tag:featureArea=messaging AND error count > 5 in 15m',
    threshold: '5 errors in 15 minutes',
    action: 'Alert iOS team, check App Store rejection risk',
    priority: 'critical',
  },
  {
    name: 'Media upload errors above threshold',
    description: 'Media upload failure rate exceeds 10%',
    conditions: 'tag:featureArea=media AND tag:media.operation=upload',
    threshold: '10 errors in 30 minutes',
    action: 'Check Supabase storage, CDN status',
    priority: 'high',
  },
  {
    name: 'Checkout failure spike',
    description: 'Ticket checkout failures spike (revenue impact)',
    conditions: 'tag:featureArea=checkout OR tag:flow=ticket',
    threshold: '3 errors in 10 minutes',
    action: 'Check Stripe status, alert payments team',
    priority: 'critical',
  },
  {
    name: 'Sneaky Link connection failure spike',
    description: 'Video room connection failures spike',
    conditions: 'tag:featureArea=sneaky-link AND tag:sneaky_link.operation=connect',
    threshold: '5 errors in 15 minutes',
    action: 'Check Fishjam status, TURN/STUN servers',
    priority: 'high',
  },
  {
    name: 'Payload/blog 500 spike',
    description: 'Payload CMS returning 500 errors',
    conditions: 'tag:featureArea=blog AND tag:api.statusCode=500',
    threshold: '5 errors in 10 minutes',
    action: 'Check Payload server, database connection',
    priority: 'high',
  },
  {
    name: 'Admin dashboard unavailable',
    description: 'Admin dashboard load failures',
    conditions: 'tag:featureArea=admin AND flow=admin.dashboard.load',
    threshold: '3 errors in 5 minutes',
    action: 'Check vite-web deployment, Payload admin',
    priority: 'high',
  },
  {
    name: 'High JS fatal error count',
    description: 'Fatal JavaScript errors across all platforms',
    conditions: 'level=fatal AND platform in (ios, android)',
    threshold: '5 fatal errors in 1 hour',
    action: 'Investigate crash, consider hotfix OTA',
    priority: 'critical',
  },
  {
    name: 'High unhandled promise rejection count',
    description: 'Unhandled promise rejections indicate missing error handling',
    conditions: 'mechanism.type=onunhandledrejection',
    threshold: '20 errors in 1 hour',
    action: 'Review async error handling, add try/catch',
    priority: 'medium',
  },
];
