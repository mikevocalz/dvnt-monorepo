/**
 * @dvnt/observability — Performance spans
 *
 * Create performance measurement spans around expensive operations.
 * Works with Sentry Performance monitoring (transactions/spans).
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

/**
 * Start a Sentry performance span.
 * Uses the new Sentry SDK `startSpan` API.
 * Falls back gracefully if performance monitoring is not enabled.
 */
export function startSentrySpan<T>(
  name: string,
  op: string,
  context: Record<string, unknown>,
  callback: (span: any) => T,
): T | undefined {
  const sentry = getSentry();
  if (!sentry?.startSpan) {
    // Performance monitoring not available — just execute callback
    return callback(null);
  }

  const safeContext = sanitizeForSentry(context);

  return sentry.startSpan(
    {
      name,
      op,
      attributes: safeContext as Record<string, any>,
    },
    callback,
  );
}

/**
 * Measure an async operation with a Sentry span.
 * Automatically records duration and captures errors.
 */
export async function measureAsync<T>(
  name: string,
  op: string,
  context: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const sentry = getSentry();
  const startTime = Date.now();

  try {
    if (sentry?.startSpan) {
      const safeContext = sanitizeForSentry(context);
      return await sentry.startSpan(
        { name, op, attributes: safeContext as Record<string, any> },
        async () => fn(),
      );
    }
    return await fn();
  } catch (error) {
    // Record the error but re-throw
    if (sentry) {
      sentry.withScope((scope: any) => {
        scope.setTag('span.name', name);
        scope.setTag('span.op', op);
        scope.setExtra('span.duration_ms', Date.now() - startTime);
        sentry.captureException(error);
      });
    }
    throw error;
  }
}

/**
 * Create a simple timer for manual span tracking when the full Sentry
 * span API is not desired.
 */
export function createTimer(name: string, op: string) {
  const startTime = Date.now();

  return {
    finish(status: 'ok' | 'error' = 'ok', data?: Record<string, unknown>) {
      const duration = Date.now() - startTime;
      const sentry = getSentry();
      if (!sentry) return duration;

      sentry.addBreadcrumb({
        category: `perf.${op}`,
        message: `${name} completed in ${duration}ms`,
        data: {
          name,
          op,
          duration_ms: duration,
          status,
          ...(data ? sanitizeForSentry(data) : {}),
        },
        level: status === 'error' ? 'warning' : 'info',
      });

      return duration;
    },
  };
}
