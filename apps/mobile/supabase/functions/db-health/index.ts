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
