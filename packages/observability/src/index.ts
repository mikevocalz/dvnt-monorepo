/**
 * @dvnt/observability — Main barrel export
 *
 * Production-grade Sentry observability layer for DVNT.
 * Shared by both expo-app (mobile) and vite-web (admin/blog).
 *
 * Architecture:
 *   - types.ts        → Core type definitions and sensitive key registry
 *   - sanitize.ts     → Privacy/redaction layer (beforeSend, sanitizeForSentry)
 *   - user.ts         → Safe user context (identifySentryUser, clearSentryUser)
 *   - context.ts      → Route/screen/feature tagging
 *   - breadcrumbs.ts  → Safe breadcrumb wrappers
 *   - spans.ts        → Performance measurement spans
 *   - capture.ts      → Error capture utilities (handled, API, flow, media, etc.)
 *   - release.ts      → OTA/release health tracking
 *   - bridge.ts       → Product analytics bridge (Supabase ↔ Sentry)
 *   - flows/          → Per-feature flow instrumentation
 */

import type { SentrySDK } from './types';

// Re-export all modules (excluding internal setSentryInstance from each)
export * from './types';
export * from './sanitize';
export { identifySentryUser, clearSentryUser } from './user';
export { setSentryRouteContext, setSentryAuthState, setSentryNetworkStatus, setSentryWebContext } from './context';
export { addSentryBreadcrumb, addNavigationBreadcrumb, addHttpBreadcrumb, addUserActionBreadcrumb } from './breadcrumbs';
export { startSentrySpan, measureAsync, createTimer } from './spans';
export { captureHandledError, captureApiError, captureFlowFailure, captureMediaFailure, captureSneakyLinkFailure, captureMessageFlowFailure, captureModerationDebugEvent } from './capture';
export { setReleaseInfo, getReleaseInfo, updateOTAInfo, buildReleaseString } from './release';
export * from './bridge';

// Re-export flows as namespace
export * as flows from './flows/index';

// ─── Initialization ──────────────────────────────────────────────────────────

import { setSentryInstance as setUserSentry } from './user';
import { setSentryInstance as setContextSentry } from './context';
import { setSentryInstance as setBreadcrumbsSentry } from './breadcrumbs';
import { setSentryInstance as setSpansSentry } from './spans';
import { setSentryInstance as setCaptureSentry } from './capture';
import { setSentryInstance as setReleaseSentry } from './release';

/**
 * Initialize the observability layer with a Sentry SDK instance.
 * Call this once at app startup, after Sentry.init().
 *
 * @param sentry — The Sentry SDK (either @sentry/react-native or @sentry/react)
 */
export function initObservability(sentry: SentrySDK): void {
  setUserSentry(sentry);
  setContextSentry(sentry);
  setBreadcrumbsSentry(sentry);
  setSpansSentry(sentry);
  setCaptureSentry(sentry);
  setReleaseSentry(sentry);
}
