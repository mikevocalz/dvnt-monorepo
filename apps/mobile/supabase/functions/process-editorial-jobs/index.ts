/**
 * process-editorial-jobs — the editorial queue worker, driven by cron.
 *
 * It moves a job one stage per run:
 *   intake    → validated   (source provenance is present)
 *   generated → awaiting_approval | approved | rejected
 *   approved  → scheduled   (a future scheduled_for, one transition only)
 *   scheduled → parked      (nothing publishes an editorial post yet)
 *
 * NOTHING HERE MODERATES CONTENT. obviousTextBlocklist is a three-phrase
 * substring scan of JSON.stringify(payload) and cannot see inside an image or
 * a video. It is why requires_human_approval is forced true for every lane
 * that allows image or video, in requiresHumanApproval and again in the
 * editorial_profiles_visual_requires_approval constraint. A real moderation
 * provider has to be wired in before any lane is set enabled = true.
 *
 * Claiming, not selecting. The previous version read 50 rows ordered by
 * created_at with no lease, so two overlapping cron invocations processed the
 * same rows and both wrote transitions. Worse, a due approved/scheduled job
 * fell off the end of the stage chain with no action and no stage change, so
 * it was re-selected every run — 50 of those starve every newer job forever.
 * claim_editorial_jobs now leases rows with FOR UPDATE SKIP LOCKED (the shape
 * public.claim_brand_messages already uses), and anything the worker cannot
 * act on is either parked or kept out of the claim set by the RPC's predicate.
 *
 * Every lease is released on a successful transition so the next stage is
 * picked up on the following run instead of waiting out the lease.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isEngagementAction,
  isVerifiedAdultRow,
  nextStageAfterBlocklist,
  obviousTextBlocklist,
  sourcePolicySatisfied,
} from "../_shared/editorial-safety.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Rows per invocation. Smaller than the old 50 because each row is a write. */
const CLAIM_LIMIT = 25;
/** How long a claim holds a row against a concurrent invocation. */
const CLAIM_LEASE = "5 minutes";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Job = any;

/** Positive 18+ identity evidence for an engagement target. */
async function verifiedAdultTarget(db: Db, userId: string) {
  const { data } = await db
    .from("identity_verifications")
    .select("status,date_of_birth")
    .eq("user_id", userId)
    .maybeSingle();
  return isVerifiedAdultRow(data);
}

/** Move a job on and drop the lease, so the next stage runs on the next pass. */
async function advance(db: Db, job: Job, patch: Record<string, unknown>) {
  await db
    .from("editorial_jobs")
    .update({ ...patch, claimed_at: null, updated_at: new Date().toISOString() })
    .eq("id", job.id);
}

/**
 * Take a job out of the queue when this worker can do nothing with it.
 *
 * A parked row is skipped by claim_editorial_jobs, so it cannot be re-claimed
 * on every run and cannot starve newer jobs. It is not a failure and not a
 * rejection: the job is intact and an operator clears parked_at once whatever
 * it is waiting for exists.
 */
async function park(db: Db, job: Job, reason: string) {
  await db
    .from("editorial_jobs")
    .update({
      parked_at: new Date().toISOString(),
      parked_reason: reason.slice(0, 500),
      claimed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

async function fail(db: Db, job: Job, error: string) {
  await db
    .from("editorial_jobs")
    .update({
      stage: "failed",
      last_error: error.slice(0, 500),
      claimed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET") || "";
  if (!secret) {
    console.error("[process-editorial-jobs] CRON_SECRET not set — rejecting request");
    return new Response("Misconfigured", { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claimed, error: claimError } = await db.rpc("claim_editorial_jobs", {
    p_limit: CLAIM_LIMIT,
    p_lease: CLAIM_LEASE,
  });
  if (claimError) {
    return new Response(JSON.stringify({ ok: false, error: claimError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const jobs: Job[] = claimed || [];
  // Ten rows. One read beats a join on every claim, and the RPC has already
  // excluded jobs whose lane is disabled, paused or unbound.
  const { data: profileRows } = await db.from("editorial_profiles").select("*");
  const profiles = new Map(
    (profileRows || []).map((p: Job) => [String(p.id), p]),
  );

  let advanced = 0;
  let parked = 0;

  for (const job of jobs) {
    const profile = profiles.get(String(job.profile_id));
    if (!profile) {
      await park(db, job, "The editorial profile row for this job is missing");
      parked++;
      continue;
    }

    try {
      if (job.job_type === "engagement") {
        const action = String(job.engagement_action || "");
        const targetUserId = String(job.target_user_id || "");
        const allowed = isEngagementAction(action) &&
          targetUserId &&
          (await verifiedAdultTarget(db, targetUserId));
        if (!allowed) {
          await db.from("editorial_engagement_audit").insert({
            profile_id: profile.id,
            job_id: job.id,
            action: isEngagementAction(action) ? action : "comment",
            target_user_id: targetUserId || null,
            target_post_id: job.target_post_id || null,
            reason: "Execution blocked: target is not a verified adult",
            status: "blocked",
          });
          await advance(db, job, {
            stage: "rejected",
            last_error: "Editorial engagement target is not verified 18+",
          });
          advanced++;
          continue;
        }
      }

      if (job.stage === "intake") {
        if (!sourcePolicySatisfied(profile, job.source_snapshot)) {
          await fail(db, job, "Required source provenance is missing");
          continue;
        }
        // Generation is provider-agnostic. A separate trusted generator writes
        // generated_payload using this immutable job id; this worker never
        // posts an ungenerated placeholder as if it were content.
        await advance(db, job, { stage: "validated" });
        await db.from("editorial_job_events").insert({
          job_id: job.id,
          stage: "validated",
          actor_type: "system",
        });
        advanced++;
        continue;
      }

      if (job.stage === "generated") {
        const scan = obviousTextBlocklist(job.generated_payload, profile);
        const next = nextStageAfterBlocklist(profile, scan);
        await advance(db, job, { stage: next, moderation_result: scan });
        await db.from("editorial_job_events").insert({
          job_id: job.id,
          stage: next,
          actor_type: "moderation",
          detail: scan,
        });
        advanced++;
        continue;
      }

      if (job.stage === "approved" || job.stage === "scheduled") {
        const due = !job.scheduled_for || Date.parse(job.scheduled_for) <= Date.now();
        if (!due) {
          // Only 'approved' reaches here: the RPC does not claim a 'scheduled'
          // job before its time. One transition, then it waits in the index.
          await advance(db, job, { stage: "scheduled" });
          advanced++;
          continue;
        }

        // Publication deliberately fails closed until an approved payload
        // exists. A publish writer can consume approved_payload with job.id as
        // its idempotency key, and posts.editorial_job_id is UNIQUE, so a retry
        // cannot duplicate a post.
        if (!job.approved_payload && !job.generated_payload) {
          await fail(db, job, "No approved payload to publish");
          continue;
        }

        // The honest end of the chain. There is no publish writer on this
        // branch, so the job is parked with its reason rather than left to be
        // re-claimed on every run. Wiring the writer means: insert the post
        // with editorial_job_id = job.id and disclosure_label copied from
        // profile.disclosure_label (posts_editorial_disclosure_present makes
        // the label mandatory), set published_post_id and stage = 'published',
        // then clear parked_at on whatever is already waiting here.
        await park(
          db,
          job,
          "Approved and due, but no publish writer exists for editorial posts yet",
        );
        parked++;
        continue;
      }

      await park(db, job, `No worker action for stage ${job.stage}`);
      parked++;
    } catch (e) {
      await db
        .from("editorial_jobs")
        .update({
          stage: "failed",
          attempt_count: (job.attempt_count || 0) + 1,
          last_error: String((e as Error)?.message || e).slice(0, 500),
          claimed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, claimed: jobs.length, advanced, parked }),
    { headers: { "Content-Type": "application/json" } },
  );
});
