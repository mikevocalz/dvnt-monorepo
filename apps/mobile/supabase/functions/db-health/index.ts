/**
 * db-health — A10 database availability probe.
 *
 * GET /db-health          → { ok, latencyMs } (Sentry Uptime monitor hits this)
 * GET /db-health?checkin=1 → same, wrapped in a Sentry cron check-in
 *                            (pg_cron self-run every minute). The missed-
 *                            check-in alert is the dead-man's switch: it fires
 *                            even when this probe CANNOT run (pooler down,
 *                            project paused, function platform down).
 *
 * The query goes through PostgREST via supabase-js — the same client path the
 * app uses — so it exercises gateway + pooler + Postgres, not just a socket.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@10";
import { withSentry, captureEdge } from "../_shared/sentry.ts";

const MONITOR_SLUG = "db-health";
// captureCheckIn's upsert config (verified: @sentry/core exports.d.ts:142)
// auto-creates the monitor — no dashboard step needed.
const MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "* * * * *" },
  checkinMargin: 2,
  maxRuntime: 1,
  timezone: "Etc/UTC",
} as const;

async function probe(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const start = performance.now();
  const { error } = await supabase.from("cities").select("id").limit(1);
  const latencyMs = Math.round(performance.now() - start);
  return error ? { ok: false, latencyMs, error: error.message } : { ok: true, latencyMs };
}

// ── WS-3 dead-man watchdog ────────────────────────────────────────────────
// Free-tier substitute for paid Sentry cron monitors (docs/sentry-budget.md
// "Decision LOCKED"): each money/critical job writes public.job_heartbeats;
// this probe (pg_cron every minute) reads it and raises ONE clamped Sentry
// error per overdue job via the existing captureEdge path. A job is overdue
// when now() − last_ok_at exceeds its interval + margin below.
//
// Per-job SLA (interval + margin). Overdue threshold = interval + margin.
type JobSla = { intervalMs: number; marginMs: number; note: string };
const MINUTE = 60_000;
const MONEY_JOB_SLA: Record<string, JobSla> = {
  // live pg_cron */5 (notify-sale-open-every-5min)
  "notify-sale-open": { intervalMs: 5 * MINUTE, marginMs: 5 * MINUTE, note: "cron */5" },
  // re-scheduled */5 (20260809100100_cart_hold_cleanup_reschedule.sql)
  "cart-hold-cleanup": { intervalMs: 5 * MINUTE, marginMs: 5 * MINUTE, note: "cron */5" },
  // documented "every 15 minutes" (reconcile-orders header); NOT in live
  // cron.job — cadence unverified, generous margin to avoid false positives.
  "reconcile-orders": { intervalMs: 15 * MINUTE, marginMs: 15 * MINUTE, note: "~15m, not in cron.job (unverified)" },
  // documented "hourly" (payouts-release header); NOT in live cron.job.
  "payouts-release": { intervalMs: 60 * MINUTE, marginMs: 30 * MINUTE, note: "~hourly, not in cron.job (unverified)" },
  // client-fired on feed load (lib/api/promotions.ts sweep), not cron — lenient.
  "spotlight-expiry": { intervalMs: 60 * MINUTE, marginMs: 60 * MINUTE, note: "client-fired on feed load, not cron" },
};

async function watchMoneyJobs(): Promise<void> {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const jobNames = Object.keys(MONEY_JOB_SLA);
    const { data, error } = await supabase
      .from("job_heartbeats")
      .select("job_name, last_ok_at, alerted_at")
      .in("job_name", jobNames);
    if (error) {
      console.error("[db-health] watchdog read failed:", error.message);
      return;
    }
    const rows = new Map(
      (data ?? []).map((r: any) => [r.job_name as string, r]),
    );
    const nowMs = Date.now();
    for (const [job, sla] of Object.entries(MONEY_JOB_SLA)) {
      const row = rows.get(job);
      // Absent row / never-OK = not yet observed since deploy. A dead-man
      // switch only fires for a job that WAS running and stopped, so skip —
      // this also prevents a first-deploy flood before any job has run.
      if (!row || !row.last_ok_at) continue;
      const overdueByMs =
        nowMs - new Date(row.last_ok_at).getTime() - (sla.intervalMs + sla.marginMs);
      if (overdueByMs <= 0) continue;
      // Clamp: one error per outage, re-armed only after `interval` elapses —
      // not once per minute. record_job_heartbeat clears alerted_at on the
      // next OK run, so recovery re-arms the alarm automatically.
      const alertedMs = row.alerted_at ? new Date(row.alerted_at).getTime() : 0;
      if (alertedMs && nowMs - alertedMs < sla.intervalMs) continue;
      await captureEdge(
        new Error(
          `job_heartbeats watchdog: '${job}' overdue — no OK run since ` +
            `${row.last_ok_at} (SLA ${(sla.intervalMs + sla.marginMs) / MINUTE}m, ${sla.note})`,
        ),
        { function: "db-health" },
      );
      await supabase
        .from("job_heartbeats")
        .update({ alerted_at: new Date().toISOString() })
        .eq("job_name", job);
    }
  } catch (e) {
    // Watchdog must never break the db-health probe / its own check-in.
    console.error("[db-health] watchdog threw:", e);
  }
}

Deno.serve(
  withSentry("db-health", async (req) => {
    const isCheckin = new URL(req.url).searchParams.get("checkin") === "1";

    const checkInId = isCheckin
      ? Sentry.captureCheckIn(
          { monitorSlug: MONITOR_SLUG, status: "in_progress" },
          MONITOR_CONFIG,
        )
      : null;

    const result = await probe();

    // Dead-man sweep of the money-job fleet (clamped, one error per overdue
    // job). Isolated from the probe/check-in outcome above.
    await watchMoneyJobs();

    if (checkInId) {
      Sentry.captureCheckIn(
        {
          checkInId,
          monitorSlug: MONITOR_SLUG,
          status: result.ok ? "ok" : "error",
          duration: result.latencyMs / 1000,
        },
        MONITOR_CONFIG,
      );
    }
    if (!result.ok) {
      await captureEdge(new Error(`db-health probe failed: ${result.error}`), {
        function: "db-health",
      });
    }
    await Sentry.flush(2000);

    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 503,
      headers: { "Content-Type": "application/json" },
    });
  }),
);
