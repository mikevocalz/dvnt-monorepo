/**
 * Shared in-memory rate limiter for Edge Functions.
 *
 * Uses a sliding-window counter stored in a Map. Since Deno Deploy
 * edge functions are short-lived, the Map resets on cold start —
 * this provides best-effort protection against bursts, not a
 * persistent store. For persistent limits, use the DB-backed
 * `check_rate_limit` / `record_rate_limit` RPCs.
 *
 * Usage:
 *   import { checkRateLimit } from "../_shared/rate-limit.ts";
 *
 *   const rl = checkRateLimit(userId, "toggle-like", { maxRequests: 30, windowMs: 60_000 });
 *   if (!rl.allowed) {
 *     return errorResponse("rate_limited", `Too many requests. Retry after ${rl.retryAfterMs}ms`);
 *   }
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimitOptions {
  /** Max requests per window (default: 30) */
  maxRequests?: number;
  /** Window duration in ms (default: 60_000 = 1 minute) */
  windowMs?: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

// In-memory store: key → { count, windowStart }
// Deno Deploy isolates share memory within a single instance,
// so this provides per-instance burst protection.
const store = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent unbounded growth (every 5 minutes)
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function maybeCleanup(windowMs: number): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, entry] of store) {
    if (now - entry.windowStart > windowMs * 2) {
      store.delete(key);
    }
  }
}

/**
 * Check and record a rate limit hit.
 *
 * @param identifier - Unique key (e.g. userId, IP, or userId:action)
 * @param action - Action name for namespacing (e.g. "toggle-like")
 * @param opts - Rate limit configuration
 */
export function checkRateLimit(
  identifier: string,
  action: string,
  opts: RateLimitOptions = {},
): RateLimitResult {
  const { maxRequests = 30, windowMs = 60_000 } = opts;
  const now = Date.now();
  const key = `${action}:${identifier}`;

  maybeCleanup(windowMs);

  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    // New window
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxRequests - 1, retryAfterMs: 0 };
  }

  if (entry.count >= maxRequests) {
    // Over limit
    const retryAfterMs = windowMs - (now - entry.windowStart);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  // Under limit — increment
  entry.count++;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    retryAfterMs: 0,
  };
}

// ── Preset configurations for common actions ─────────────────────────

/** Auth actions: 10 requests per minute */
export const AUTH_LIMIT = { maxRequests: 10, windowMs: 60_000 };

/** Write actions (likes, follows, comments): 30 per minute */
export const WRITE_LIMIT = { maxRequests: 30, windowMs: 60_000 };

/** Heavy writes (posts, stories, events): 5 per minute */
export const CREATE_LIMIT = { maxRequests: 5, windowMs: 60_000 };

/** Messages: 60 per minute */
export const MESSAGE_LIMIT = { maxRequests: 60, windowMs: 60_000 };

/** Media uploads: 10 per minute */
export const UPLOAD_LIMIT = { maxRequests: 10, windowMs: 60_000 };
