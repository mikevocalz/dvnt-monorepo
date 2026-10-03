/**
 * Rate limit backed by public.video_rate_limits through the check_rate_limit
 * and record_rate_limit RPCs, the same pair video_join_room uses. Unlike the
 * in-memory limiter in rate-limit.ts, the count is shared by every isolate
 * and survives a cold start, so a script cannot reset it by landing on a new
 * instance.
 *
 * Fails closed: if the check errors or returns anything but true, the request
 * is refused. The hit is recorded only when it is allowed, so a caller that
 * keeps hammering after the limit does not extend its own lockout.
 */

export interface DbRateLimitResult {
  allowed: boolean;
  /** Set when the check itself failed, so the caller can log it. */
  error?: string;
}

export async function consumeDbRateLimit(
  supabase: any,
  key: string,
  action: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<DbRateLimitResult> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_user_id: key,
    p_action: action,
    p_room_id: null,
    p_max_attempts: maxAttempts,
    p_window_seconds: windowSeconds,
  });
  if (error) return { allowed: false, error: error.message ?? String(error) };
  if (data !== true) return { allowed: false };

  const { error: recordError } = await supabase.rpc("record_rate_limit", {
    p_user_id: key,
    p_action: action,
    p_room_id: null,
  });
  if (recordError) return { allowed: false, error: recordError.message ?? String(recordError) };
  return { allowed: true };
}
