/**
 * @dvnt/observability — Product analytics bridge
 *
 * Clean bridge between Supabase analytics_events and Sentry.
 * For important flows:
 *   - Write business event to Supabase (source of truth)
 *   - Add diagnostic breadcrumb to Sentry
 *   - Capture handled errors to Sentry only when something fails
 *   - Never duplicate full analytics into Sentry
 */

import { addSentryBreadcrumb } from './breadcrumbs';
import { captureFlowFailure } from './capture';
import type { FeatureArea } from './types';

export interface AnalyticsBridgeEvent {
  /** The event name for Supabase analytics_events table */
  analyticsEvent: string;
  /** Sentry breadcrumb category */
  sentryCategory: string;
  /** Feature area for grouping */
  featureArea: FeatureArea;
  /** Safe metadata (no PII) */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Record a successful flow step.
 * - Adds a Sentry breadcrumb for diagnostic trail
 * - Returns the event for caller to write to Supabase
 *
 * The caller is responsible for writing to Supabase analytics_events.
 * Sentry only gets a breadcrumb, not a full event.
 */
export function bridgeFlowSuccess(event: AnalyticsBridgeEvent): void {
  addSentryBreadcrumb(
    event.sentryCategory,
    `${event.analyticsEvent} succeeded`,
    event.metadata as Record<string, unknown> | undefined,
    'info',
  );
}

/**
 * Record a failed flow step.
 * - Adds a Sentry breadcrumb + captures the error
 * - Returns the event for caller to write failure to Supabase
 *
 * Example:
 *   bridgeFlowFailure({
 *     analyticsEvent: 'message_button_tapped',
 *     sentryCategory: 'message.button.tap',
 *     featureArea: 'messaging',
 *     error: err,
 *     step: 'route_transition',
 *   });
 */
export function bridgeFlowFailure(event: AnalyticsBridgeEvent & {
  error: unknown;
  step: string;
}): void {
  addSentryBreadcrumb(
    event.sentryCategory,
    `${event.analyticsEvent} failed at ${event.step}`,
    event.metadata as Record<string, unknown> | undefined,
    'error',
  );

  captureFlowFailure(
    event.sentryCategory,
    event.step,
    event.error,
    {
      analyticsEvent: event.analyticsEvent,
      featureArea: event.featureArea,
      ...(event.metadata ?? {}),
    },
  );
}

/**
 * Record a flow start (breadcrumb only, no error).
 */
export function bridgeFlowStart(event: AnalyticsBridgeEvent): void {
  addSentryBreadcrumb(
    event.sentryCategory,
    `${event.analyticsEvent} started`,
    event.metadata as Record<string, unknown> | undefined,
    'info',
  );
}
