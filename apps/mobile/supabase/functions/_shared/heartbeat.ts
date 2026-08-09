/**
 * Dead-man heartbeats for scheduled/critical edge jobs (WS-3, free-tier form).
 *
 * The house decision is LOCKED to the free Sentry Developer tier — NO paid
 * cron monitors (docs/sentry-budget.md). Instead every money/critical job
 * writes a row to public.job_heartbeats via the service-role RPC
 * record_job_heartbeat; the db-health probe polls that table and raises ONE
 * clamped Sentry error per overdue job. This module is the write side.
 *
 * Style mirrors _shared/sentry.ts: self-contained (owns its own service
 * client), and every path is swallow-on-failure — a heartbeat write, or the
 * skip-if-running lock, must NEVER break the money path it measures.
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

let _client: SupabaseClient | null = null;
function serviceClient(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _client;
}

/** Low-level heartbeat write. Never throws. */
export async function recordHeartbeat(
  jobName: string,
  ok: boolean,
  durationMs: number | null,
  detail: Record<string, unknown> | null = null,
  status: "in_progress" | "ok" | "error" = ok ? "ok" : "error",
): Promise<void> {
  try {
    const { error } = await serviceClient().rpc("record_job_heartbeat", {
      p_job: jobName,
      p_status: status,
      p_ok: ok,
      p_duration_ms: durationMs === null ? null : Math.round(durationMs),
      p_detail: detail,
    });
    if (error) console.error(`[heartbeat:${jobName}] record failed:`, error.message);
  } catch (e) {
    console.error(`[heartbeat:${jobName}] record threw:`, e);
  }
}

/**
 * Skip-if-running guard (WS-4). Returns true when this run holds the lock and
 * should proceed. Fail-OPEN: an RPC error returns true so a DB/telemetry hiccup
 * can never block a payout — the jobs' own per-row CAS is the real double-run
 * defense; this lock only stops the common stampede case.
 */
export async function tryClaimJob(jobName: string, ttlSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await serviceClient().rpc("try_claim_job", {
      p_job: jobName,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      console.error(`[heartbeat:${jobName}] claim failed (fail-open):`, error.message);
      return true;
    }
    return data === true;
  } catch (e) {
    console.error(`[heartbeat:${jobName}] claim threw (fail-open):`, e);
    return true;
  }
}

/** Release the skip-if-running lock. Never throws. */
export async function releaseJob(jobName: string): Promise<void> {
  try {
    await serviceClient().rpc("release_job_lock", { p_job: jobName });
  } catch (e) {
    console.error(`[heartbeat:${jobName}] release threw:`, e);
  }
}

/**
 * Wrap a job body: record `in_progress` at the start, then `ok`/`error` with
 * the elapsed duration at the end. Rethrows whatever `fn` throws (job behavior
 * is unchanged); only the heartbeat bookkeeping is added and it never throws on
 * its own.
 *
 * When `fn` resolves to a Response, an HTTP status >= 500 is recorded as an
 * error outcome (the job returned a server-error body without throwing), so
 * caught-and-returned 500s still trip the dead-man switch. Any other return
 * type is treated as OK on a clean resolve.
 *
 * A structured result line is emitted to the log stream on completion for the
 * allowlisted-tag observability path (WS-4 structured result logging).
 */
export async function withHeartbeat<T>(
  jobName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  await recordHeartbeat(jobName, false, null, { phase: "started" }, "in_progress");
  try {
    const result = await fn();
    const durationMs = performance.now() - startedAt;
    const httpStatus =
      result instanceof Response ? result.status : undefined;
    const ok = httpStatus === undefined ? true : httpStatus < 500;
    console.log(
      JSON.stringify({
        job: jobName,
        outcome: ok ? "ok" : "error",
        durationMs: Math.round(durationMs),
        httpStatus,
      }),
    );
    await recordHeartbeat(
      jobName,
      ok,
      durationMs,
      { httpStatus: httpStatus ?? null },
    );
    return result;
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    console.log(
      JSON.stringify({
        job: jobName,
        outcome: "error",
        durationMs: Math.round(durationMs),
        error: String(error),
      }),
    );
    await recordHeartbeat(jobName, false, durationMs, {
      error: String(error),
    });
    throw error;
  }
}
