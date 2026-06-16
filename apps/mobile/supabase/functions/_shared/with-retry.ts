/**
 * Shared retry wrapper for Supabase DB queries in Edge Functions.
 *
 * Retries on transient Postgres errors (connection reset, timeout, etc.)
 * but NOT on application-level errors (unique constraint, RLS denied).
 *
 * Usage:
 *   import { withRetry } from "../_shared/with-retry.ts";
 *
 *   const { data, error } = await withRetry(() =>
 *     supabase.from("posts").select("*").eq("id", postId).single()
 *   );
 */

interface RetryOptions {
  /** Max number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms — doubles each retry (default: 200) */
  baseDelayMs?: number;
  /** Label for logging (default: "db") */
  label?: string;
}

// Postgres error codes that are transient and worth retrying
const TRANSIENT_PG_CODES = new Set([
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "57014", // query_canceled (timeout)
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);

// HTTP/network error substrings that indicate transient failures
const TRANSIENT_MESSAGES = [
  "fetch failed",
  "network",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "socket hang up",
  "connection reset",
  "too many connections",
];

function isTransient(error: any): boolean {
  if (!error) return false;

  // Supabase PostgREST errors include a `code` field
  if (error.code && TRANSIENT_PG_CODES.has(error.code)) return true;

  // Check error message for network-level failures
  const msg = (error.message || error.msg || String(error)).toLowerCase();
  return TRANSIENT_MESSAGES.some((t) => msg.includes(t.toLowerCase()));
}

/**
 * Execute a Supabase query with automatic retry on transient failures.
 *
 * Returns the same `{ data, error }` shape as Supabase client calls.
 */
export async function withRetry<T>(
  fn: () => PromiseLike<{ data: T; error: any }>,
  opts: RetryOptions = {},
): Promise<{ data: T; error: any }> {
  const { maxAttempts = 3, baseDelayMs = 200, label = "db" } = opts;

  let lastResult: { data: T; error: any } = { data: null as T, error: null };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      lastResult = await fn();

      // Success or non-transient error — return immediately
      if (!lastResult.error || !isTransient(lastResult.error)) {
        return lastResult;
      }

      // Transient error — log and retry
      console.warn(
        `[${label}] Transient DB error (attempt ${attempt}/${maxAttempts}):`,
        lastResult.error.code || lastResult.error.message,
      );
    } catch (thrown) {
      // fn() itself threw (network error, etc.)
      if (!isTransient(thrown) || attempt === maxAttempts) {
        return {
          data: null as T,
          error: thrown instanceof Error ? { message: thrown.message } : thrown,
        };
      }

      console.warn(
        `[${label}] Thrown error (attempt ${attempt}/${maxAttempts}):`,
        thrown instanceof Error ? thrown.message : thrown,
      );

      lastResult = {
        data: null as T,
        error: thrown instanceof Error ? { message: thrown.message } : thrown,
      };
    }

    // Exponential backoff before next attempt
    if (attempt < maxAttempts) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return lastResult;
}
