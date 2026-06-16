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
]);

export const SAFE_EMAIL_DOMAINS = new Set([
  'dvntapp.live',
  'dvnt.app',
]);
