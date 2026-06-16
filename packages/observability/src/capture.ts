/**
 * @dvnt/observability — Error capture utilities
 *
 * Standard ways to capture handled errors, API errors, flow failures,
 * media failures, Sneaky Link failures, and message flow failures.
 * All capture functions sanitize data before sending to Sentry.
 */

import type {
  SentrySDK,
  CaptureContext,
  ApiErrorContext,
  MediaFailureContext,
  SneakyLinkFailureContext,
  MessageFlowFailureContext,
  ModerationDebugContext,
  SeverityLevel,
} from './types';
import { sanitizeForSentry } from './sanitize';

let _sentry: SentrySDK | null = null;

export function setSentryInstance(sentry: SentrySDK): void {
  _sentry = sentry;
}

function getSentry(): SentrySDK | null {
  return _sentry;
}

// ─── Handled Error Capture ───────────────────────────────────────────────────

/**
 * Capture a handled error with tags, level, feature area, route, and safe metadata.
 */
export function captureHandledError(
  error: unknown,
  context: CaptureContext,
): void {
  const sentry = getSentry();
  if (!sentry) {
    console.error('[DVNT Observability] captureHandledError:', error, context);
    return;
  }

  sentry.withScope((scope: any) => {
    if (context.level) scope.setLevel(context.level);
    if (context.featureArea) scope.setTag('featureArea', context.featureArea);
    if (context.route) scope.setTag('route', context.route);
    if (context.screen) scope.setTag('screen', context.screen);

    if (context.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }

    if (context.extra) {
      const safeExtra = sanitizeForSentry(context.extra as Record<string, unknown>);
      for (const [key, value] of Object.entries(safeExtra)) {
        scope.setExtra(key, value);
      }
    }

    sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

// ─── API Error Capture ───────────────────────────────────────────────────────

/**
 * Capture a Supabase/API/Payload error safely.
 * Includes endpoint, query name, status, duration. Never includes tokens or private payloads.
 */
export function captureApiError(
  error: unknown,
  requestContext: ApiErrorContext & CaptureContext,
): void {
  const sentry = getSentry();
  if (!sentry) {
    console.error('[DVNT Observability] captureApiError:', error, requestContext);
    return;
  }

  sentry.withScope((scope: any) => {
    scope.setTag('featureArea', requestContext.featureArea ?? 'api');
    scope.setTag('error.type', 'api_error');

    if (requestContext.endpoint) scope.setTag('api.endpoint', requestContext.endpoint);
    if (requestContext.method) scope.setTag('api.method', requestContext.method);
    if (requestContext.queryName) scope.setTag('api.queryName', requestContext.queryName);
    if (requestContext.statusCode) scope.setTag('api.statusCode', String(requestContext.statusCode));
    if (requestContext.collection) scope.setTag('api.collection', requestContext.collection);
    if (requestContext.route) scope.setTag('route', requestContext.route);
    if (requestContext.screen) scope.setTag('screen', requestContext.screen);

    scope.setContext('api_request', {
      endpoint: requestContext.endpoint ?? null,
      method: requestContext.method ?? null,
      queryName: requestContext.queryName ?? null,
      statusCode: requestContext.statusCode ?? null,
      durationMs: requestContext.durationMs ?? null,
      collection: requestContext.collection ?? null,
    });

    if (requestContext.tags) {
      for (const [key, value] of Object.entries(requestContext.tags)) {
        scope.setTag(key, value);
      }
    }

    sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

// ─── Flow Failure Capture ────────────────────────────────────────────────────

/**
 * Standard way to capture a failed app flow step.
 */
export function captureFlowFailure(
  flowName: string,
  stepName: string,
  error: unknown,
  metadata?: Record<string, unknown>,
): void {
  const sentry = getSentry();
  if (!sentry) {
    console.error('[DVNT Observability] captureFlowFailure:', flowName, stepName, error);
    return;
  }

  sentry.withScope((scope: any) => {
    scope.setTag('flow', flowName);
    scope.setTag('flow.step', stepName);
    scope.setTag('error.type', 'flow_failure');
    scope.setLevel('error');

    const safeMetadata = metadata ? sanitizeForSentry(metadata) : {};
    scope.setContext('flow_failure', {
      flow: flowName,
      step: stepName,
      ...safeMetadata,
    });

    sentry.captureException(error instanceof Error ? error : new Error(
      `Flow failure: ${flowName}.${stepName} — ${error instanceof Error ? error.message : String(error)}`
    ));
  });
}

// ─── Media Failure Capture ───────────────────────────────────────────────────

/**
 * Standard media upload/playback failure capture.
 */
export function captureMediaFailure(
  error: unknown,
  metadata: MediaFailureContext,
): void {
  const sentry = getSentry();
  if (!sentry) {
    console.error('[DVNT Observability] captureMediaFailure:', error, metadata);
    return;
  }

  sentry.withScope((scope: any) => {
    scope.setTag('featureArea', 'media');
    scope.setTag('error.type', 'media_failure');
    if (metadata.mediaType) scope.setTag('media.type', metadata.mediaType);
    if (metadata.operation) scope.setTag('media.operation', metadata.operation);

    scope.setContext('media_failure', {
      mediaType: metadata.mediaType ?? null,
      operation: metadata.operation ?? null,
      fileSize: metadata.fileSize ?? null,
      mimeType: metadata.mimeType ?? null,
      uploadProgress: metadata.uploadProgress ?? null,
    });

    sentry.captureException(error instanceof Error ? error : new Error(
      `Media failure: ${metadata.operation ?? 'unknown'} — ${error instanceof Error ? error.message : String(error)}`
    ));
  });
}

// ─── Sneaky Link Failure Capture ─────────────────────────────────────────────

/**
 * Standard video room / Sneaky Link failure capture.
 */
export function captureSneakyLinkFailure(
  error: unknown,
  metadata: SneakyLinkFailureContext,
): void {
  const sentry = getSentry();
  if (!sentry) {
    console.error('[DVNT Observability] captureSneakyLinkFailure:', error, metadata);
    return;
  }

  sentry.withScope((scope: any) => {
    scope.setTag('featureArea', 'sneaky-link');
    scope.setTag('error.type', 'sneaky_link_failure');
    if (metadata.operation) scope.setTag('sneaky_link.operation', metadata.operation);
    if (metadata.permissionType) scope.setTag('sneaky_link.permission', metadata.permissionType);

    scope.setContext('sneaky_link_failure', {
      roomId: metadata.roomId ?? null,
      participantCount: metadata.participantCount ?? null,
      operation: metadata.operation ?? null,
      permissionType: metadata.permissionType ?? null,
    });

    sentry.captureException(error instanceof Error ? error : new Error(
      `Sneaky Link failure: ${metadata.operation ?? 'unknown'} — ${error instanceof Error ? error.message : String(error)}`
    ));
  });
}

// ─── Message Flow Failure Capture ────────────────────────────────────────────

/**
 * Standard message button/inbox/thread failure capture.
 * CRITICAL: Never captures actual message text.
 */
export function captureMessageFlowFailure(
  error: unknown,
  metadata: MessageFlowFailureContext,
): void {
  const sentry = getSentry();
  if (!sentry) {
    console.error('[DVNT Observability] captureMessageFlowFailure:', error, metadata);
    return;
  }

  sentry.withScope((scope: any) => {
    scope.setTag('featureArea', 'messaging');
    scope.setTag('error.type', 'message_flow_failure');
    if (metadata.route) scope.setTag('route', metadata.route);
    if (metadata.queryName) scope.setTag('query.name', metadata.queryName);
    if (metadata.status) scope.setTag('flow.status', metadata.status);

    scope.setContext('message_flow_failure', {
      recipientId: metadata.recipientId ?? null,
      threadId: metadata.threadId ?? null,
      route: metadata.route ?? null,
      queryName: metadata.queryName ?? null,
      status: metadata.status ?? null,
      blockedState: metadata.blockedState ?? null,
      privateState: metadata.privateState ?? null,
      networkStatus: metadata.networkStatus ?? null,
    });

    sentry.captureException(error instanceof Error ? error : new Error(
      `Message flow failure: ${metadata.queryName ?? metadata.route ?? 'unknown'} — ${error instanceof Error ? error.message : String(error)}`
    ));
  });
}

// ─── Moderation Debug Capture ────────────────────────────────────────────────

/**
 * Captures debugging context for reports/blocks/moderation actions.
 * Does NOT leak private report notes.
 */
export function captureModerationDebugEvent(
  event: ModerationDebugContext & { error?: unknown; level?: SeverityLevel },
): void {
  const sentry = getSentry();
  if (!sentry) {
    console.error('[DVNT Observability] captureModerationDebugEvent:', event);
    return;
  }

  sentry.withScope((scope: any) => {
    scope.setTag('featureArea', 'trust-safety');
    scope.setTag('error.type', 'moderation_event');
    if (event.actionType) scope.setTag('moderation.action', event.actionType);
    if (event.reportReason) scope.setTag('moderation.reason', event.reportReason);
    scope.setLevel(event.level ?? 'info');

    scope.setContext('moderation_debug', {
      reportId: event.reportId ?? null,
      targetUserId: event.targetUserId ?? null,
      actionType: event.actionType ?? null,
      reportReason: event.reportReason ?? null,
      moderatorId: event.moderatorId ?? null,
      // NEVER include report notes or private details
    });

    if (event.error) {
      sentry.captureException(
        event.error instanceof Error ? event.error : new Error(String(event.error))
      );
    } else {
      sentry.captureMessage(
        `Moderation: ${event.actionType ?? 'unknown'} on user ${event.targetUserId ?? 'unknown'}`,
        event.level ?? 'info',
      );
    }
  });
}
