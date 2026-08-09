/**
 * @dvnt/observability — Core type definitions
 *
 * Shared types for the DVNT Sentry observability layer.
 * These types are platform-agnostic and used by both mobile and web.
 */

// ─── User Context ────────────────────────────────────────────────────────────

export interface SentryUserContext {
  id: string;
  username?: string;
  role?: 'user' | 'moderator' | 'admin' | 'super-admin';
  accountStatus?: 'active' | 'suspended' | 'banned' | 'deleted';
  appVersion?: string;
  buildNumber?: string;
  expoUpdateId?: string;
  updateChannel?: string;
  platform?: 'ios' | 'android' | 'web';
  deviceModel?: string;
  osVersion?: string;
}

// ─── Tag Sets ────────────────────────────────────────────────────────────────

export interface BaseTags {
  app: 'dvnt';
  package: 'expo-app' | 'vite-web';
  platform: 'ios' | 'android' | 'web';
  environment: string;
  release?: string;
  buildNumber?: string;
  appVersion?: string;
  expoUpdateId?: string;
  updateChannel?: string;
  screen?: string;
  route?: string;
  featureArea?: string;
  userRole?: string;
  authState?: 'authenticated' | 'anonymous' | 'expired';
  networkStatus?: 'online' | 'offline' | 'slow';
  deviceModel?: string;
  osVersion?: string;
}

export interface WebTags extends BaseTags {
  area?: 'blog' | 'admin' | 'dashboard';
  payloadCollection?: string;
  slug?: string;
  category?: string;
  editorMode?: string;
  previewMode?: string;
}

// ─── Flow Events ─────────────────────────────────────────────────────────────

export type FlowStage = 'started' | 'success' | 'failure';

export interface FlowEvent {
  flow: string;
  step: string;
  stage: FlowStage;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

// ─── Capture Context ─────────────────────────────────────────────────────────

export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface CaptureContext {
  level?: SeverityLevel;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  featureArea?: string;
  route?: string;
  screen?: string;
}

export interface ApiErrorContext {
  endpoint?: string;
  method?: string;
  queryName?: string;
  statusCode?: number;
  durationMs?: number;
  collection?: string;
}

export interface MediaFailureContext {
  mediaType?: 'image' | 'video' | 'audio';
  operation?: 'pick' | 'compress' | 'upload' | 'render' | 'playback';
  fileSize?: number;
  mimeType?: string;
  uploadProgress?: number;
}

export interface SneakyLinkFailureContext {
  roomId?: string;
  participantCount?: number;
  operation?: 'create' | 'join' | 'connect' | 'permission' | 'face_access';
  permissionType?: 'camera' | 'mic';
}

export interface MessageFlowFailureContext {
  recipientId?: string;
  threadId?: string;
  route?: string;
  queryName?: string;
  status?: string;
  blockedState?: boolean;
  privateState?: boolean;
  networkStatus?: string;
}

export interface ModerationDebugContext {
  reportId?: string;
  targetUserId?: string;
  actionType?: string;
  reportReason?: string;
  moderatorId?: string;
}

// ─── Release / OTA ───────────────────────────────────────────────────────────

export interface ReleaseInfo {
  appVersion: string;
  buildNumber: string;
  runtimeVersion?: string;
  expoUpdateId?: string;
  updateChannel?: string;
  releaseChannel?: string;
  environment: string;
  platform: 'ios' | 'android' | 'web';
}

// ─── Sentry SDK Abstraction ──────────────────────────────────────────────────

/**
 * Structured-logging surface (Sentry Logs product).
 *
 * Shape verified against @sentry/core 10.69.0 — the `logger` namespace is
 * `export * as logger from './logs/public-api'`
 * (node_modules/@sentry/core/build/types/shared-exports.d.ts:90), whose members
 * are `trace|debug|info|warn|error|fatal(message, attributes?, metadata?)` at
 * node_modules/@sentry/core/build/types/logs/public-api.d.ts:35,63,90,120,150,180.
 * Re-exported by @sentry/nextjs (build/types/index.types.d.ts:26) and by
 * @sentry/react-native 8.22.0 (dist/js/index.d.ts:7, via @sentry/browser).
 * Only reachable at runtime when `enableLogs: true` is set on Sentry.init
 * (options.d.ts:530). Optional here so an SDK/build without logs degrades to
 * breadcrumbs (see logs.ts).
 */
export interface SentryStructuredLogger {
  trace(message: string, attributes?: Record<string, unknown>): void;
  debug(message: string, attributes?: Record<string, unknown>): void;
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
  fatal(message: string, attributes?: Record<string, unknown>): void;
}

export interface SentrySDK {
  captureException(error: unknown, context?: any): string;
  captureMessage(message: string, level?: SeverityLevel): string;
  addBreadcrumb(breadcrumb: {
    category?: string;
    message?: string;
    data?: Record<string, any>;
    level?: string;
    type?: string;
  }): void;
  setUser(user: { id?: string; username?: string; [key: string]: any } | null): void;
  setTag(key: string, value: string): void;
  setTags(tags: Record<string, string>): void;
  setExtra(key: string, value: unknown): void;
  setContext(name: string, context: Record<string, any> | null): void;
  withScope(callback: (scope: any) => void): void;
  startSpan?<T>(context: { name: string; op?: string; attributes?: Record<string, any> }, callback: (span: any) => T): T;
  /** Structured-logging namespace — present only when the SDK build ships Logs
   *  AND `enableLogs: true` is set. Absent → logs.ts falls back to breadcrumbs. */
  logger?: SentryStructuredLogger;
}

// ─── Feature Areas ───────────────────────────────────────────────────────────

export type FeatureArea =
  | 'auth'
  | 'feed'
  | 'post'
  | 'stories'
  | 'events'
  | 'tickets'
  | 'checkout'
  | 'messaging'
  | 'sneaky-link'
  | 'media'
  | 'profile'
  | 'notifications'
  | 'moderation'
  | 'trust-safety'
  | 'blog'
  | 'admin'
  | 'dashboard'
  | 'settings'
  | 'search'
  | 'qr';

// ─── Sensitive Keys ──────────────────────────────────────────────────────────

export const REDACTED_KEYS = new Set([
  'password',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'set-cookie',
  'Set-Cookie',
  'x-auth-token',
  'apiKey',
  'api_key',
  'secret',
  'cardNumber',
  'card_number',
  'cvv',
  'cvc',
  'expiry',
  'expirationDate',
  'paymentMethodId',
  'clientSecret',
  'client_secret',
  'ephemeralKey',
  'ephemeral_key',
  'phoneNumber',
  'phone_number',
  'phone',
  'email',
  'messageBody',
  'message_body',
  'body',
  'content',
  'dmText',
  'dm_text',
  'privateNotes',
  'private_notes',
  'reportNotes',
  'report_notes',
  'signedUrl',
  'signed_url',
  'uploadUrl',
  'upload_url',
  'mediaUrl',
  'media_url',
  'unpublishedBody',
  'unpublished_body',
  'draftContent',
  'draft_content',
  // §2.4 identity/demographic denylist — these must never leave the device.
  'name',
  'firstName',
  'first_name',
  'lastName',
  'last_name',
  'dob',
  'dateOfBirth',
  'date_of_birth',
  'address',
  'gender',
  'pronouns',
  'sexuality',
  'orientation',
  'eventAudience',
  'event_audience',
  'hiv_status',
  'hivStatus',
  'answer',
  'answers',
  'id_image',
  'idImage',
]);

export const SAFE_EMAIL_DOMAINS = new Set([
  'dvntapp.live',
  'dvnt.app',
]);
