/**
 * @dvnt/observability — Data sanitization & redaction
 *
 * Centralized privacy layer. Strips sensitive data before it reaches Sentry.
 * Used in beforeSend hooks and manual capture calls.
 */

import { REDACTED_KEYS, SAFE_EMAIL_DOMAINS } from './types';

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 2048;

// ─── Email Masking ───────────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return REDACTED;
  const domain = parts[1]!.toLowerCase();
  if (SAFE_EMAIL_DOMAINS.has(domain)) return email;
  const local = parts[0]!;
  const masked = local.length <= 2
    ? '*'.repeat(local.length)
    : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
  return `${masked}@${domain}`;
}

// ─── URL Redaction ───────────────────────────────────────────────────────────

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove query params that look sensitive
    const sensitiveParams = ['token', 'key', 'secret', 'signature', 'sig', 'auth'];
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, REDACTED);
      }
    }
    // Redact signed storage URLs
    if (parsed.hostname.includes('supabase') && parsed.searchParams.has('token')) {
      return `${parsed.origin}${parsed.pathname}?[SIGNED_URL_REDACTED]`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

// ─── Key-Level Redaction ─────────────────────────────────────────────────────

function isSensitiveKey(key: string): boolean {
  if (REDACTED_KEYS.has(key)) return true;
  const lower = key.toLowerCase();
  // Exact match patterns — avoid false positives on container keys like 'tokens'
  return lower.includes('password') ||
    (lower.includes('token') && lower !== 'tokens') ||
    lower.includes('secret') ||
    lower.includes('authorization') ||
    lower.includes('cookie') ||
    (lower.includes('card') && lower !== 'cards') ||
    lower.includes('cvv') ||
    (lower.includes('phone') && lower !== 'phones') ||
    // §2.4 identity/demographic patterns — never leave the device
    lower.includes('gender') ||
    lower.includes('pronoun') ||
    lower.includes('orientation') ||
    lower.includes('sexuality') ||
    lower.includes('identity') ||
    lower.includes('hiv') ||
    lower.includes('survey') ||
    lower.includes('dob') ||
    lower.includes('birth') ||
    lower.includes('id_image') ||
    lower.includes('signed_url') ||
    lower.includes('signedurl') ||
    lower.includes('private_note') ||
    lower.includes('privatenote') ||
    lower.includes('dm_text') ||
    lower.includes('dmtext') ||
    lower.includes('message_body') ||
    lower.includes('messagebody');
}

function isEmailKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === 'email' || lower === 'user_email' || lower === 'useremail';
}

// ─── Deep Object Sanitization ────────────────────────────────────────────────

export function sanitizeValue(key: string, value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]';

  if (value === null || value === undefined) return value;

  // Email masking takes priority over full redaction
  if (typeof value === 'string' && isEmailKey(key)) return maskEmail(value);

  if (isSensitiveKey(key)) return REDACTED;

  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) return value.slice(0, MAX_STRING_LENGTH) + '…[TRUNCATED]';
    // Redact URLs that look like signed storage URLs
    if ((value.startsWith('http://') || value.startsWith('https://')) &&
        (value.includes('token=') || value.includes('X-Amz-Signature'))) {
      return redactUrl(value);
    }
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item, i) => sanitizeValue(String(i), item, depth + 1));
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      sanitized[k] = sanitizeValue(k, v, depth + 1);
    }
    return sanitized;
  }

  return String(value);
}

// ─── Top-Level Sanitizer ─────────────────────────────────────────────────────

export function sanitizeForSentry(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = sanitizeValue(key, value);
  }
  return result;
}

// ─── Request Headers Sanitization ────────────────────────────────────────────

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  const sensitiveHeaders = new Set([
    'authorization', 'cookie', 'set-cookie',
    'x-auth-token', 'x-api-key', 'x-refresh-token',
  ]);

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveHeaders.has(key.toLowerCase())) {
      result[key] = REDACTED;
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── Per-Session Fingerprint Clamp ───────────────────────────────────────────
//
// Budget guard: one bug must never be able to flood the Sentry quota again.
// After CLAMP_LIMIT error events share a fingerprint key within one session,
// further events for that key are dropped client-side (beforeSend returns
// null) and ONE summary breadcrumb is attached to the next event that does go
// out, so triage can see suppression happened.
//
// Fingerprint derivation — client-side events don't carry server-assigned
// fingerprints, so we derive one deterministically from what every error
// event has: `type|message(first 120 chars)|filename:function` of the TOP
// stack frame. Sentry orders `exception.values[0].stacktrace.frames`
// oldest-call-first, so the top (innermost) frame is the LAST array element.
// Same bug → same key across occurrences; distinct bugs practically never
// collide. Message-only events key on the message; events with neither an
// exception nor a message are never clamped.
//
// State is a module-level Map: per-page-session in the browser, per-isolate on
// server/edge (no window/document references — safe on every runtime). The
// map is wiped if it ever tracks an implausible number of distinct keys, which
// bounds memory on long-lived server processes.

const DEFAULT_CLAMP_LIMIT = 5;
const MAX_TRACKED_FINGERPRINTS = 1000;

const clampCounts = new Map<string, number>();
const clampedKeys = new Set<string>();
let pendingClampBreadcrumbs: Array<Record<string, unknown>> = [];

/** Deterministic per-bug key. See derivation comment above. */
export function deriveFingerprintKey(event: any): string {
  const exception = event?.exception?.values?.[0];
  const type = exception?.type ?? 'Error';
  const message = String(exception?.value ?? event?.message ?? '').slice(0, 120);
  const frames = exception?.stacktrace?.frames;
  const top = Array.isArray(frames) && frames.length > 0 ? frames[frames.length - 1] : undefined;
  const frame = top ? `${top.filename ?? '?'}:${top.function ?? '?'}` : 'noframe';
  return `${type}|${message}|${frame}`;
}

/** True when an event's derived fingerprint has hit the clamp — used by the
 *  replay integration's beforeErrorSampling to skip error-replay capture. */
export function isEventClamped(event: any): boolean {
  return clampedKeys.has(deriveFingerprintKey(event));
}

/** Reset clamp state. Exposed for tests. */
export function resetFingerprintClamp(): void {
  clampCounts.clear();
  clampedKeys.clear();
  pendingClampBreadcrumbs = [];
}

/**
 * Returns null (drop) when this event's fingerprint is over budget.
 * Otherwise attaches any pending clamp-summary breadcrumbs and returns the event.
 */
function applyFingerprintClamp(event: any, limit: number): any {
  // Only clamp real error events — never transactions/sessions, and never
  // events with nothing to derive a fingerprint from.
  const hasException = Boolean(event?.exception?.values?.length);
  if (event?.type || (!hasException && !event?.message)) return event;

  const key = deriveFingerprintKey(event);
  const count = (clampCounts.get(key) ?? 0) + 1;
  if (clampCounts.size >= MAX_TRACKED_FINGERPRINTS && !clampCounts.has(key)) {
    resetFingerprintClamp();
  }
  clampCounts.set(key, count);

  if (count > limit) {
    if (!clampedKeys.has(key)) {
      clampedKeys.add(key);
      pendingClampBreadcrumbs.push({
        category: 'observability.clamp',
        message: `clamped fingerprint ${key} after ${limit} events`,
        level: 'warning',
        type: 'default',
        timestamp: Date.now() / 1000,
      });
    }
    return null;
  }

  if (pendingClampBreadcrumbs.length > 0) {
    event.breadcrumbs = [...(event.breadcrumbs ?? []), ...pendingClampBreadcrumbs];
    pendingClampBreadcrumbs = [];
  }
  return event;
}

// ─── Sentry beforeSend Event Processor ───────────────────────────────────────

export interface BeforeSendOptions {
  /** Max error events per derived fingerprint per session. Default: 5. */
  clampLimit?: number;
}

export function createBeforeSend(options?: BeforeSendOptions) {
  const clampLimit = options?.clampLimit ?? DEFAULT_CLAMP_LIMIT;

  return function beforeSend(event: any, hint?: any): any {
    // Budget clamp first — a dropped event needs no sanitization.
    if (applyFingerprintClamp(event, clampLimit) === null) return null;

    // Sanitize request data
    if (event.request) {
      if (event.request.headers) {
        event.request.headers = sanitizeHeaders(event.request.headers);
      }
      if (event.request.data && typeof event.request.data === 'object') {
        event.request.data = sanitizeForSentry(event.request.data);
      }
      if (event.request.cookies) {
        event.request.cookies = REDACTED;
      }
    }

    // Sanitize breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((crumb: any) => {
        if (crumb.data && typeof crumb.data === 'object') {
          crumb.data = sanitizeForSentry(crumb.data);
        }
        return crumb;
      });
    }

    // Sanitize extra/contexts
    if (event.extra && typeof event.extra === 'object') {
      event.extra = sanitizeForSentry(event.extra);
    }

    if (event.contexts && typeof event.contexts === 'object') {
      for (const [ctxName, ctxValue] of Object.entries(event.contexts)) {
        if (ctxValue && typeof ctxValue === 'object') {
          event.contexts[ctxName] = sanitizeForSentry(ctxValue as Record<string, unknown>);
        }
      }
    }

    // Sanitize user context — mask email
    if (event.user?.email) {
      event.user.email = maskEmail(event.user.email);
    }

    return event;
  };
}

// ─── Sentry beforeSendTransaction Processor ──────────────────────────────────

export function createBeforeSendTransaction() {
  return function beforeSendTransaction(event: any): any {
    // Strip sensitive span data
    if (event.spans) {
      event.spans = event.spans.map((span: any) => {
        if (span.data && typeof span.data === 'object') {
          span.data = sanitizeForSentry(span.data);
        }
        return span;
      });
    }
    return event;
  };
}
