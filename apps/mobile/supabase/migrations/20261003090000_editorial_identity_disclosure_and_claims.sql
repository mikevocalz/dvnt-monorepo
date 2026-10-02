-- Closes four defects in 20261002220000_editorial_automation.sql.
--
-- C2  editorial_profiles.account_auth_id had no FK and no marker, and
--     editorial-admin passed it through an allow-list straight into an UPDATE.
--     Pointing it at a member's Better Auth id made AI output publish AS THAT
--     MEMBER. public.users.is_editorial is now the marker, and a BEFORE trigger
--     refuses any binding to a row without it — so a direct service-role UPDATE
--     cannot disagree with the edge function's check either.
--
-- C3  disclosure_label lived on editorial_profiles and was read in exactly one
--     admin-only GET. posts carried no flag, so the feed could not know a post
--     was editorial. posts.editorial_job_id and posts.disclosure_label carry it
--     to the reader, and a CHECK makes the label mandatory whenever the job id
--     is set. The feed renders the badge off BOTH columns: a member can write a
--     label on a post they own, but they cannot read editorial_jobs (REVOKEd
--     from anon and authenticated) so they cannot supply a real job id.
--
-- H6  requires_human_approval was an operator switch even on the image and
--     video lanes, where the only automated gate is a three-phrase substring
--     scan of the JSON payload that cannot see into a rendered image.
--     editorial_profiles_visual_requires_approval nails it true for any lane
--     allowing image or video.
--
-- H7  the worker selected 50 jobs with no lease, so two overlapping cron
--     invocations processed the same rows, and a due approved/scheduled job
--     with no publisher fell out of the stage chain untouched and was
--     re-selected every run — 50 of those starve every newer job forever.
--     claim_editorial_jobs leases with FOR UPDATE SKIP LOCKED (same shape as
--     claim_brand_messages), parked_at takes the no-op case out of the queue,
--     and published_post_id is unique so a future publish writer cannot
--     double-post.
--
-- No row is inserted, updated or deleted here. Designating an account is a
-- deliberate, separate act: a migration sets users.is_editorial = true for that
-- one account. Nothing in the API can set it, and every lane stays
-- enabled = false, paused = true until someone changes it on purpose.

BEGIN;

-- ── C2 · the editorial-account marker ──────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_editorial boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.is_editorial IS
  'True only for DVNT editorial automation accounts. Set by migration; no API path writes it. editorial_profiles.account_auth_id must name a row where this is true.';

-- Covers the lookup the trigger and the edge function both make: auth_id among
-- editorial accounts. Partial, because the marker is true for a handful of rows
-- in a table of members.
CREATE INDEX IF NOT EXISTS users_editorial_auth_id_idx
  ON public.users (auth_id)
  WHERE is_editorial;

CREATE OR REPLACE FUNCTION public.editorial_profiles_require_editorial_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.account_auth_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF btrim(NEW.account_auth_id) = '' THEN
    RAISE EXCEPTION 'account_auth_id cannot be blank'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.users u
     WHERE u.auth_id = NEW.account_auth_id
       AND u.is_editorial
  ) THEN
    -- The rejected id is deliberately not echoed. An operator comparing
    -- against their own config does not need it in the Postgres log.
    RAISE EXCEPTION 'account_auth_id does not name an account with users.is_editorial = true'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS editorial_profiles_account_guard ON public.editorial_profiles;
CREATE TRIGGER editorial_profiles_account_guard
  BEFORE INSERT OR UPDATE OF account_auth_id ON public.editorial_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.editorial_profiles_require_editorial_account();

-- ── H6 · visual lanes keep their human ─────────────────────────────────────
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so this is the re-runnable
-- form. Every seeded lane already carries requires_human_approval = true, so
-- the constraint validates against existing rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'editorial_profiles_visual_requires_approval'
       AND conrelid = 'public.editorial_profiles'::regclass
  ) THEN
    ALTER TABLE public.editorial_profiles
      ADD CONSTRAINT editorial_profiles_visual_requires_approval
      CHECK (
        requires_human_approval
        OR NOT (allowed_content_types && ARRAY['image','video']::text[])
      );
  END IF;
END $$;

-- ── C3 · the disclosure reaches the reader ─────────────────────────────────
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS editorial_job_id uuid,
  ADD COLUMN IF NOT EXISTS disclosure_label text;

COMMENT ON COLUMN public.posts.editorial_job_id IS
  'The editorial_jobs row that produced this post. NULL for every member post.';
COMMENT ON COLUMN public.posts.disclosure_label IS
  'Copied from editorial_profiles.disclosure_label at publish time so the feed can render it without reading the admin tables.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'posts_editorial_job_id_fkey'
       AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_editorial_job_id_fkey
      FOREIGN KEY (editorial_job_id) REFERENCES public.editorial_jobs(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- One post per job, and a plain (not partial) UNIQUE so a publish writer can
-- infer it from `onConflict: "editorial_job_id"`. NULLs stay distinct in
-- Postgres, so member posts are unaffected. This also indexes the FK column.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'posts_editorial_job_id_key'
       AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_editorial_job_id_key UNIQUE (editorial_job_id);
  END IF;
END $$;

-- An editorial post without its label is the exact defect this closes, so the
-- table refuses one rather than trusting the writer to remember.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'posts_editorial_disclosure_present'
       AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_editorial_disclosure_present
      CHECK (
        editorial_job_id IS NULL
        OR (disclosure_label IS NOT NULL AND btrim(disclosure_label) <> '')
      );
  END IF;
END $$;

-- ── H7 · lease the queue, park the no-ops, one post per job ────────────────
ALTER TABLE public.editorial_jobs
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS parked_at timestamptz,
  ADD COLUMN IF NOT EXISTS parked_reason text;

COMMENT ON COLUMN public.editorial_jobs.claimed_at IS
  'Lease stamp set by claim_editorial_jobs. A second worker skips a row whose lease has not expired. Cleared on every stage transition so the next stage is picked up on the next run.';
COMMENT ON COLUMN public.editorial_jobs.parked_at IS
  'Set when the worker can take no action on a due job — today, an approved job with no publish writer. Parked rows leave the claim set, so they cannot starve newer jobs.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'editorial_jobs_published_post_id_key'
       AND conrelid = 'public.editorial_jobs'::regclass
  ) THEN
    ALTER TABLE public.editorial_jobs
      ADD CONSTRAINT editorial_jobs_published_post_id_key UNIQUE (published_post_id);
  END IF;
END $$;

-- Matches the claim predicate. claimed_at cannot join the WHERE clause here —
-- now() is not IMMUTABLE — so the lease is compared inside the function.
CREATE INDEX IF NOT EXISTS editorial_jobs_claimable_idx
  ON public.editorial_jobs (created_at)
  WHERE parked_at IS NULL
    AND stage IN ('intake','generated','approved','scheduled');

-- Same shape as public.claim_brand_messages: one atomic UPDATE whose row set
-- comes from a FOR UPDATE SKIP LOCKED subselect, so two overlapping cron
-- invocations take disjoint work instead of both transitioning the same job.
--
-- Three of the four predicates exist to keep a job that the worker cannot act
-- on out of the claim set entirely, rather than letting it take a slot, no-op,
-- and come back next run. That spin is what starved the queue:
--
--   parked_at        a job the worker has already declared untreatable
--   lane runnable    every lane ships enabled = false, paused = true, so
--                    without this the worker would claim 25 jobs a run and
--                    advance none of them. Unlike parking, this reverses
--                    itself: enable the lane and its jobs are claimable again.
--   scheduled + due  a job already moved to 'scheduled' waits for its time
--                    without being claimed. 'approved' with a future time is
--                    still claimed once, to make that one transition.
CREATE OR REPLACE FUNCTION public.claim_editorial_jobs(
  p_limit integer DEFAULT 25,
  p_lease interval DEFAULT interval '5 minutes'
) RETURNS SETOF public.editorial_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.editorial_jobs j
     SET claimed_at = now(),
         updated_at = now()
   WHERE j.id IN (
     SELECT c.id
       FROM public.editorial_jobs c
      WHERE c.parked_at IS NULL
        AND c.stage IN ('intake','generated','approved','scheduled')
        AND (c.claimed_at IS NULL OR c.claimed_at < now() - p_lease)
        AND (
          c.stage <> 'scheduled'
          OR c.scheduled_for IS NULL
          OR c.scheduled_for <= now()
        )
        AND EXISTS (
          SELECT 1
            FROM public.editorial_profiles p
           WHERE p.id = c.profile_id
             AND p.enabled
             AND NOT p.paused
             AND p.account_auth_id IS NOT NULL
        )
      ORDER BY c.created_at
      LIMIT GREATEST(COALESCE(p_limit, 0), 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_editorial_jobs(integer, interval)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.editorial_profiles_require_editorial_account()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_editorial_jobs(integer, interval) TO service_role;

COMMIT;
