/**
 * @dvnt/observability — Blog / admin / Payload flow instrumentation (vite-web)
 */

import { addSentryBreadcrumb } from '../breadcrumbs';
import { captureFlowFailure, captureApiError } from '../capture';
import { createTimer } from '../spans';

// ─── Blog Index ──────────────────────────────────────────────────────────────

export function blogIndexLoadStarted() {
  addSentryBreadcrumb('blog.index', 'blog.index.load.started');
  return createTimer('blog.index.load', 'blog');
}

export function blogIndexLoadSuccess(durationMs?: number) {
  addSentryBreadcrumb('blog.index', 'blog.index.load.success', { durationMs });
}

export function blogIndexLoadFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('blog.index', 'blog.index.load.failure', metadata, 'error');
  captureFlowFailure('blog', 'index.load', error, metadata);
}

// ─── Blog Post ───────────────────────────────────────────────────────────────

export function blogPostLoadStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('blog.post', 'blog.post.load.started', metadata);
  return createTimer('blog.post.load', 'blog');
}

export function blogPostLoadSuccess(durationMs?: number) {
  addSentryBreadcrumb('blog.post', 'blog.post.load.success', { durationMs });
}

export function blogPostLoadFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('blog.post', 'blog.post.load.failure', metadata, 'error');
  captureFlowFailure('blog', 'post.load', error, metadata);
}

// ─── Payload Fetch ───────────────────────────────────────────────────────────

export function payloadFetchStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('payload.fetch', 'payload.fetch.started', metadata);
  return createTimer('payload.fetch', 'blog');
}

export function payloadFetchSuccess(durationMs?: number) {
  addSentryBreadcrumb('payload.fetch', 'payload.fetch.success', { durationMs });
}

export function payloadFetchFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('payload.fetch', 'payload.fetch.failure', metadata, 'error');
  captureApiError(error, {
    featureArea: 'blog',
    queryName: 'payload_fetch',
    ...metadata,
  });
}

// ─── Payload Preview ─────────────────────────────────────────────────────────

export function payloadPreviewOpened(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('payload.preview', 'payload.preview.opened', metadata);
}

export function payloadPreviewFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('payload.preview', 'payload.preview.failure', metadata, 'error');
  captureFlowFailure('payload', 'preview', error, metadata);
}

// ─── Rich Text Render ────────────────────────────────────────────────────────

export function richTextRenderFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('rich_text.render', 'rich_text.render.failure', metadata, 'error');
  captureFlowFailure('rich_text', 'render', error, metadata);
}

// ─── Newsletter ──────────────────────────────────────────────────────────────

export function newsletterSubmitStarted() {
  addSentryBreadcrumb('newsletter.submit', 'newsletter.submit.started');
  return createTimer('newsletter.submit', 'blog');
}

export function newsletterSubmitSuccess() {
  addSentryBreadcrumb('newsletter.submit', 'newsletter.submit.success');
}

export function newsletterSubmitFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('newsletter.submit', 'newsletter.submit.failure', metadata, 'error');
  captureFlowFailure('newsletter', 'submit', error, metadata);
}

// ─── Admin Dashboard ─────────────────────────────────────────────────────────

export function adminDashboardLoadStarted() {
  addSentryBreadcrumb('admin.dashboard', 'admin.dashboard.load.started');
  return createTimer('admin.dashboard.load', 'admin');
}

export function adminDashboardLoadFailure(error: unknown) {
  addSentryBreadcrumb('admin.dashboard', 'admin.dashboard.load.failure', undefined, 'error');
  captureFlowFailure('admin', 'dashboard.load', error);
}

export function adminUsersLoadFailure(error: unknown) {
  addSentryBreadcrumb('admin.users', 'admin.users.load.failure', undefined, 'error');
  captureFlowFailure('admin', 'users.load', error);
}

export function adminReportsLoadFailure(error: unknown) {
  addSentryBreadcrumb('admin.reports', 'admin.reports.load.failure', undefined, 'error');
  captureFlowFailure('admin', 'reports.load', error);
}

export function adminAnalyticsLoadFailure(error: unknown) {
  addSentryBreadcrumb('admin.analytics', 'admin.analytics.load.failure', undefined, 'error');
  captureFlowFailure('admin', 'analytics.load', error);
}

export function adminSentryHealthLoadFailure(error: unknown) {
  addSentryBreadcrumb('admin.sentry_health', 'admin.sentry_health.load.failure', undefined, 'error');
  captureFlowFailure('admin', 'sentry_health.load', error);
}
