/**
 * @dvnt/observability — Safe breadcrumb wrapper
 *
 * Automatically redacts sensitive keys from breadcrumb data.
 * Provides typed category prefixes for organized Sentry trails.
 */

import type { SentrySDK } from './types';
import { sanitizeForSentry } from './sanitize';

let _sentry: SentrySDK | null = null;

export function setSentryInstance(sentry: SentrySDK): void {
  _sentry = sentry;
}

function getSentry(): SentrySDK | null {
  return _sentry;
}

export type BreadcrumbLevel = 'info' | 'warning' | 'error' | 'debug';

/**
 * Add a safe breadcrumb to Sentry.
 * Data is automatically redacted for sensitive keys.
 */
export function addSentryBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: BreadcrumbLevel = 'info',
): void {
  const sentry = getSentry();
  if (!sentry) return;

  sentry.addBreadcrumb({
    category,
    message,
    data: data ? sanitizeForSentry(data) as Record<string, any> : undefined,
    level,
    type: 'default',
  });
}

/**
 * Add a navigation breadcrumb.
 */
export function addNavigationBreadcrumb(from: string, to: string): void {
  const sentry = getSentry();
  if (!sentry) return;

  sentry.addBreadcrumb({
    category: 'navigation',
    message: `${from} → ${to}`,
    data: { from, to },
    level: 'info',
    type: 'navigation',
  });
}

/**
 * Add an HTTP breadcrumb (for manual API tracking).
 */
export function addHttpBreadcrumb(
  method: string,
  url: string,
  statusCode?: number,
  durationMs?: number,
): void {
  const sentry = getSentry();
  if (!sentry) return;

  // Redact signed URLs
  const safeUrl = url.includes('token=') || url.includes('X-Amz-Signature')
    ? url.split('?')[0] + '?[PARAMS_REDACTED]'
    : url;

  sentry.addBreadcrumb({
    category: 'http',
    message: `${method} ${safeUrl}`,
    data: {
      method,
      url: safeUrl,
      status_code: statusCode,
      duration_ms: durationMs,
    },
    level: statusCode && statusCode >= 400 ? 'error' : 'info',
    type: 'http',
  });
}

/**
 * Add a user interaction breadcrumb.
 */
export function addUserActionBreadcrumb(
  action: string,
  target: string,
  data?: Record<string, unknown>,
): void {
  const sentry = getSentry();
  if (!sentry) return;

  sentry.addBreadcrumb({
    category: 'ui.action',
    message: `${action}: ${target}`,
    data: data ? sanitizeForSentry(data) as Record<string, any> : undefined,
    level: 'info',
    type: 'user',
  });
}
