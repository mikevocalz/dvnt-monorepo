/**
 * backfill-verification-emails Edge Function
 *
 * POST /backfill-verification-emails   (operator only, x-cron-secret)
 * Body: { dry_run?: boolean, limit?: number, batch_size?: number,
 *         batch_delay_ms?: number, cooldown_days?: number,
 *         campaign_version?: string }
 *
 * Sends the verification email to accounts that never got one. Better Auth
 * ignored sendVerificationEmail for the life of the product because it sat
 * inside emailAndPassword instead of the top-level emailVerification block, so
 * 1113 of 1137 rows in public."user" have "emailVerified" IS NOT TRUE.
 *
 * It does not mint tokens. Each recipient goes through the auth function's own
 * POST /api/auth/send-verification-email, so the token, its 24h expiry and the
 * verifyEmailLink template are byte-for-byte what a new signup gets. Nothing
 * about the email is re-implemented here.
 *
 * Bounded, throttled and resumable:
 *   - dry_run defaults TRUE. It reports who would be mailed and sends nothing.
 *   - limit defaults 25 and is capped at MAX_LIMIT, so one invocation can
 *     never attempt the whole list.
 *   - rows are claimed in public.verification_email_backfill, so a crash or a
 *     repeat run resumes instead of re-mailing.
 *   - anyone who verified since being queued, or was mailed inside the
 *     cooldown, is suppressed by claim_verification_backfill before a send.
 *   - one recipient's failure records last_error and the run continues.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MAX_ATTEMPTS, transition } from "../_shared/brand-outbox.ts";
import {
  batchDelayMs,
  batches,
  maskEmail,
  resolvePlan,
  throttleBudgetMs,
} from "../_shared/verification-backfill.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live")
  .replace(/\/+$/, "");

/** The auth edge function, mounted at /functions/v1/auth with basePath /api/auth. */
const SEND_VERIFICATION_URL =
  `${SUPABASE_URL}/functions/v1/auth/api/auth/send-verification-email`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-cron-secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * One recipient, through the real endpoint. Better Auth answers
 * `{"status":true}`; anything else is a failure with the body kept as the
 * reason so last_error says what the provider actually said.
 *
 * callbackURL makes the link first-party on web (webFirstPartyEmailLink in the
 * auth function rewrites it); native builds fall back to the legacy link, the
 * same as a fresh signup.
 */
async function sendVerification(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string; retryable: boolean }> {
  let res: Response;
  try {
    res = await fetch(SEND_VERIFICATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        email,
        callbackURL: `${SITE_URL}/auth/verify-email`,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `network:${String((err as Error)?.message || err)}`,
      retryable: true,
    };
  }

  const text = (await res.text()).slice(0, 300);
  if (res.ok) {
    try {
      if (JSON.parse(text)?.status === true) return { ok: true };
    } catch {
      // Fall through: a 2xx that is not the documented body is not a send.
    }
    return { ok: false, error: `unexpected_body:${text}`, retryable: false };
  }
  // 4xx is the request (bad address, unknown account); 5xx and 429 are worth
  // another pass.
  return {
    ok: false,
    error: `http_${res.status}:${text}`,
    retryable: res.status >= 500 || res.status === 429,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Operator only, and it fails CLOSED like brand-outbox-worker: with no secret
  // configured there is no way to tell an operator from anyone else, and the
  // blast radius is 1113 inboxes.
  if (!CRON_SECRET) return json({ error: "CRON_SECRET is not set" }, 503);
  if ((req.headers.get("x-cron-secret") || "") !== CRON_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const plan = resolvePlan(body, Deno.env.toObject());

    // Enqueue runs on a dry run too: it only writes outbox rows, and doing it
    // first is what makes the dry run report the real queue.
    const { data: enqueued, error: enqueueError } = await supabase.rpc(
      "enqueue_verification_backfill",
      { p_campaign_version: plan.campaignVersion },
    );
    if (enqueueError) {
      console.error("[backfill-verification-emails] enqueue:", enqueueError);
      return json({ error: "Could not enqueue recipients" }, 500);
    }

    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_verification_backfill",
      {
        p_campaign_version: plan.campaignVersion,
        p_limit: plan.limit,
        p_cooldown: `${plan.cooldownDays} days`,
        p_dry_run: plan.dryRun,
      },
    );
    if (claimError) {
      console.error("[backfill-verification-emails] claim:", claimError);
      return json({ error: "Could not claim recipients" }, 500);
    }

    const rows = (claimed || []) as Array<Record<string, any>>;
    const recipients = rows.map((r) => maskEmail(String(r.email)));

    if (plan.dryRun) {
      console.log(
        `[backfill-verification-emails] dry run: ${rows.length} would be mailed`,
      );
      return json({
        ok: true,
        data: {
          dry_run: true,
          plan,
          enqueued: enqueued ?? 0,
          attempted: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          would_send: rows.length,
          throttle_budget_ms: throttleBudgetMs(
            rows.length,
            plan.batchSize,
            plan.batchDelayMs,
          ),
          recipients,
        },
      });
    }

    return await drain(supabase, rows, plan, enqueued ?? 0);
  } catch (err: any) {
    console.error("[backfill-verification-emails] Unexpected:", err);
    return json({ error: err?.message || "Internal error" }, 500);
  }
});

/** Cumulative per-reason suppression totals for the campaign, not just this run. */
async function suppressedTotals(supabase: any, campaignVersion: string) {
  const reasons = ["already_verified", "mailed_recently", "account_missing"];
  const totals: Record<string, number> = {};
  for (const reason of reasons) {
    const { count } = await supabase
      .from("verification_email_backfill")
      .select("id", { count: "exact", head: true })
      .eq("campaign_version", campaignVersion)
      .eq("state", "suppressed")
      .eq("last_error", reason);
    totals[reason] = count ?? 0;
  }
  return totals;
}

/**
 * Send the claimed rows in throttled batches. Every row is completed one way or
 * another before the next batch starts, so an invocation that dies mid-run
 * leaves at most one batch stuck in `sending`; those rows are picked up by the
 * next run once they are re-queued by hand, which is the tradeoff below.
 *
 * ponytail: no reaper for rows abandoned in `sending`. The ceiling is that a
 * killed invocation needs one UPDATE to move its claimed rows back to 'queued'.
 * A claimed_at-based reclaim is the upgrade when this runs on a schedule.
 */
async function drain(
  supabase: any,
  rows: Array<Record<string, any>>,
  plan: ReturnType<typeof resolvePlan>,
  enqueued: number,
): Promise<Response> {
  let sent = 0;
  let failed = 0;
  let retrying = 0;
  const reasons: Record<string, number> = {};
  const note = (error: string) => {
    const key = error.split(":")[0];
    reasons[key] = (reasons[key] ?? 0) + 1;
  };

  const groups = batches(rows, plan.batchSize);
  for (let i = 0; i < groups.length; i++) {
    await sleep(batchDelayMs(i, plan.batchDelayMs));

    await Promise.all(groups[i].map(async (row) => {
      const result = await sendVerification(String(row.email));
      const outcome = result.ok
        ? "delivered"
        : result.retryable
        ? "transient_error"
        : "permanent_error";
      const next = transition("sending", outcome, Number(row.attempt_count));
      if (!next) {
        console.error("[backfill-verification-emails] no transition:", row.id);
        return;
      }
      const { error: completeError } = await supabase.rpc(
        "complete_verification_backfill",
        {
          p_id: row.id,
          p_state: next.state,
          p_error: result.ok ? null : result.error,
        },
      );
      if (completeError) {
        console.error(
          "[backfill-verification-emails] complete:",
          row.id,
          completeError,
        );
        return;
      }
      if (next.state === "sent") sent += 1;
      else if (next.state === "failed") failed += 1;
      else retrying += 1;
      if (!result.ok) note(result.error);
    }));
  }

  return json({
    ok: true,
    data: {
      dry_run: false,
      plan,
      enqueued,
      attempted: rows.length,
      sent,
      failed,
      retrying,
      // attempted - sent - failed - retrying is the count whose completion RPC
      // itself failed; those rows stay claimed and are reported, not hidden.
      stuck_sending: rows.length - sent - failed - retrying,
      max_attempts: MAX_ATTEMPTS,
      failure_reasons: reasons,
      suppressed_totals: await suppressedTotals(supabase, plan.campaignVersion),
    },
  });
}
