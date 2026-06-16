/**
 * @dvnt/observability — Vite-web (browser) Sentry initialization
 *
 * Call this in apps/web-vite entry point.
 * Configures Sentry for the admin dashboard / blog with:
 *   - Browser performance monitoring
 *   - Session replay
 *   - beforeSend redaction
 *   - Web-specific tags
 */

import { createBeforeSend, createBeforeSendTransaction } from '../sanitize';
import { initObservability } from '../index';
import { setReleaseInfo } from '../release';
import type { ReleaseInfo } from '../types';

export interface WebSentryConfig {
  dsn: string;
  environment: string;
  appVersion: string;
  /** Set to false in development */
  enabled?: boolean;
  /** Sample rate for errors (0-1). Default: 1.0 */
  sampleRate?: number;
  /** Sample rate for performance traces (0-1). Default: 0.5 */
  tracesSampleRate?: number;
  /** Session replay sample rate (0-1). Default: 0.1 */
  replaysSessionSampleRate?: number;
  /** Error session replay sample rate (0-1). Default: 1.0 */
  replaysOnErrorSampleRate?: number;
}

/**
 * Initialize Sentry for the vite-web admin/blog app.
 *
 * Usage in main.tsx or router.tsx:
 * ```ts
 * import * as Sentry from '@sentry/react';
 * import { initWebSentry } from '@dvnt/observability/init/web';
 *
 * initWebSentry(Sentry, {
 *   dsn: import.meta.env.VITE_SENTRY_DSN,
 *   environment: import.meta.env.MODE,
 *   appVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
 * });
 * ```
 */
export function initWebSentry(Sentry: any, config: WebSentryConfig): void {
  Sentry.init({
    dsn: config.dsn,
    enabled: config.enabled ?? true,
    environment: config.environment,
    release: `dvnt-web@${config.appVersion}`,

    // Sampling
    sampleRate: config.sampleRate ?? 1.0,
    tracesSampleRate: config.tracesSampleRate ?? 0.5,
    replaysSessionSampleRate: config.replaysSessionSampleRate ?? 0.1,
    replaysOnErrorSampleRate: config.replaysOnErrorSampleRate ?? 1.0,

    // Privacy
    beforeSend: createBeforeSend(),
    beforeSendTransaction: createBeforeSendTransaction(),

    // Integrations
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Mask all text content and block all media in replays for privacy
        maskAllText: false, // We control what's sensitive via beforeSend
        blockAllMedia: false,
        // Block sensitive inputs
        maskAllInputs: true,
      }),
    ],

    // Tags set on every event
    initialScope: {
      tags: {
        app: 'dvnt',
        package: 'vite-web',
        platform: 'web',
        appVersion: config.appVersion,
      },
    },

    // Ignore common non-actionable errors
    ignoreErrors: [
      'ResizeObserver loop',
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      /^Loading chunk/,
      /^ChunkLoadError/,
    ],

    // Don't send events from these URLs
    denyUrls: [
      /extensions\//i,
      /^chrome:\/\//i,
      /^moz-extension:\/\//i,
    ],
  });

  // Wire up the observability layer
  initObservability(Sentry);

  // Set release info
  const releaseInfo: ReleaseInfo = {
    appVersion: config.appVersion,
    buildNumber: '0',
    environment: config.environment,
    platform: 'web',
  };
  setReleaseInfo(releaseInfo);
}
