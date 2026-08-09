/**
 * @dvnt/observability — Structured logs seam (Sentry Logs product)
 *
 * The home for webhook outcomes + client funnel breadcrumbs, routed to Sentry's
 * Logs category (0/5 GB reserved — headroom is the point, budget §1).
 *
 * ─── Verified SDK surface (installed) ───
 *   `Sentry.logger` namespace: trace|debug|info|warn|error|fatal(message, attributes?)
 *     — @sentry/core 10.69.0 shared-exports.d.ts:90 (+ logs/public-api.d.ts:35,63,90,120,150,180),
 *       re-exported by @sentry/nextjs (index.types.d.ts:26) and
 *       @sentry/react-native 8.22.0 (dist/js/index.d.ts:7, via @sentry/browser).
 *   Requires `enableLogs: true` on Sentry.init — options.d.ts:530.
 *
 * Degradation contract: if the injected SDK has no `logger` (older build, or
 * enableLogs off), every helper falls back to a breadcrumb — never throws, never
 * invents an API. Logs emitted inside an active span are auto-correlated to the
 * trace (SerializedLog.trace_id, log.d.ts) — no manual stitching needed.
 */

import type { SentrySDK, SentryStructuredLogger } from './types';
import { sanitizeForSentry } from './sanitize';

let _sentry: SentrySDK | null = null;

export function setSentryInstance(sentry: SentrySDK): void {
  _sentry = sentry;
}

function getSentry(): SentrySDK | null {
  return _sentry;
}

export type LogLevel = keyof SentryStructuredLogger; // 'trace'|'debug'|'info'|'warn'|'error'|'fatal'

const BREADCRUMB_LEVEL: Record<LogLevel, 'info' | 'warning' | 'error' | 'debug'> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
  fatal: 'error',
};

/**
 * Emit one structured log. Sampled where chatty (`sampleRate` < 1). Attributes
 * are scrubbed by the §2.4 redaction layer before they leave the process.
 * Falls back to a breadcrumb when the SDK has no logs surface.
 */
export function emitLog(
  level: LogLevel,
  message: string,
  attributes?: Record<string, unknown>,
  sampleRate = 1,
): void {
  if (sampleRate < 1 && Math.random() > sampleRate) return;

  const sentry = getSentry();
  if (!sentry) return;

  const safe = attributes ? sanitizeForSentry(attributes) : undefined;

  if (sentry.logger && typeof sentry.logger[level] === 'function') {
    sentry.logger[level](message, safe);
    return;
  }

  // No structured-logging surface — degrade to a breadcrumb (never invent an API).
  sentry.addBreadcrumb({
    category: 'log',
    message,
    data: safe as Record<string, any> | undefined,
    level: BREADCRUMB_LEVEL[level],
    type: 'default',
  });
}

/**
 * Webhook outcome log — the canonical home for Stripe / RevenueCat / CMS-sync
 * webhook results. `ok`/`skipped` land at info, `failed` at error. Correlated to
 * the request trace automatically when called inside the handler's span.
 *
 * Edge functions (stripe-webhook, purchases, promotion-webhook, notify-sale-open)
 * are owned by a parallel agent — see docs/observability-verification.md for the
 * adoption pattern; this helper is the shared shape for web + edge callers.
 */
export function logWebhookOutcome(
  webhook: string,
  outcome: 'ok' | 'skipped' | 'duplicate' | 'failed',
  attributes?: Record<string, unknown>,
): void {
  emitLog(
    outcome === 'failed' ? 'error' : 'info',
    `webhook.${webhook}.${outcome}`,
    { webhook, outcome, ...(attributes ?? {}) },
  );
}

/**
 * Client funnel-step log. Failures always log; started/success are sampled
 * (default 0.1) so a busy funnel can't flood the 5 GB logs budget.
 */
export function logFunnelStep(
  flow: string,
  step: string,
  stage: 'started' | 'success' | 'failure',
  attributes?: Record<string, unknown>,
  sampleRate?: number,
): void {
  emitLog(
    stage === 'failure' ? 'error' : 'info',
    `${flow}.${step}.${stage}`,
    { flow, step, stage, ...(attributes ?? {}) },
    sampleRate ?? (stage === 'failure' ? 1 : 0.1),
  );
}
