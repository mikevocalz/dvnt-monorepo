-- Verified admission for the whole membership, with ticket purchase left open
-- and SPICY reads gated in the database.
--
-- Replaces 20261001190000_new_signup_verified_admission.sql, which was never
-- applied (absent from supabase_migrations.schema_migrations on 2026-10-03)
-- and is deleted in the same commit. That file switched enforcement on and set
-- cohort_created_after = now(), which exempted every account that existed at
-- apply time. Checklist A03 asks for the opposite: existing unverified
-- accounts lose protected features until they verify. It also set
-- grace_deadline = now(), relying on a NULL deadline meaning "prompt forever".
--
-- This migration does NOT switch enforcement on. It changes no row in
-- verified_admission_policy. Turning the gate on is a separate operator step;
-- the runbook is at the bottom of this file.
--
-- What changes:
--   1. A NULL grace_deadline now means no grace. With enforce = true and no
--      deadline, unverified accounts are refused at once. Matches
--      decideVerifiedAdmission in functions/_shared/verified-admission.ts.
--   2. Ticket purchase, ticket holds and RSVPs leave the participation
--      boundary (checklist A01/A03). Buying or holding a ticket never needs
--      verification; using it for an adult surface (Lynk rooms) still does.
--   3. SPICY (is_nsfw) posts, their media and their text slides are visible
--      through PostgREST only to the author or to a viewer with an approved
--      adult ID. Creating or updating a post as SPICY needs the same. This
--      applies whatever verified_admission_policy says, as create-post does.
BEGIN;

-- ── 1. RLS mirror of the admission verdict ───────────────────────────────
CREATE OR REPLACE FUNCTION public.verified_participation_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role' THEN true
    ELSE (
      SELECT
        CASE
          -- An under-18 document closes participation whatever the config says.
          WHEN EXISTS (
            SELECT 1 FROM public.identity_verifications v
            WHERE v.user_id = sub.id AND v.date_of_birth IS NOT NULL
              AND v.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
          ) THEN false
          WHEN NOT p.enforce THEN true
          WHEN sub.id IS NULL THEN false
          WHEN sub.id = ANY (p.allowlist) AND NOT sub.id = ANY (p.denylist) THEN true
          WHEN NOT sub.id = ANY (p.denylist)
            AND p.cohort_created_after IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public."user" u
              WHERE u.id = sub.id AND u."createdAt" < p.cohort_created_after
            ) THEN true
          -- Grace is opt-in: only a deadline still in the future admits an
          -- unverified account. NULL means refuse.
          ELSE public.is_verified_self()
            OR (p.grace_deadline IS NOT NULL AND now() < p.grace_deadline)
        END
      FROM public.verified_admission_policy p,
           LATERAL (SELECT auth.jwt() ->> 'sub' AS id) sub
      WHERE p.id = 1
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.verified_participation_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verified_participation_allowed() TO anon, authenticated, service_role;

COMMENT ON TABLE public.verified_admission_policy IS
  'Single-row rollout configuration for verified-only participation. enforce=false is inert. '
  'With enforce=true: cohort_created_after NULL = every account in scope (checklist A03, keep it NULL); '
  'grace_deadline NULL = no grace, refused at once; a future grace_deadline = prompt until then.';
COMMENT ON COLUMN public.verified_admission_policy.grace_deadline IS
  'Prompt-only until this instant, refused after it. NULL = no grace.';
COMMENT ON COLUMN public.verified_admission_policy.cohort_created_after IS
  'Accounts created before this instant are exempt. NULL = whole membership. Checklist A03 requires NULL.';

-- ── 2. Tickets, holds and RSVPs are not participation ────────────────────
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['tickets', 'ticket_holds', 'event_rsvps'] LOOP
    CONTINUE WHEN to_regclass('public.' || quote_ident(v_table)) IS NULL;
    EXECUTE format('DROP POLICY IF EXISTS verified_participation_boundary ON public.%I', v_table);
  END LOOP;
END;
$$;

-- ── 3. SPICY visibility ──────────────────────────────────────────────────
-- Same rule as normalizeVerificationState(...).state === "approved" in
-- functions/_shared/verification-state.ts: passed, an adult date of birth no
-- more than 120 years back, and no non-retryable failure code. SECURITY
-- DEFINER because anon has no grant on identity_verifications; the account
-- comes from the JWT, never from a parameter.
CREATE OR REPLACE FUNCTION public.viewer_is_verified_adult()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.identity_verifications v
      WHERE v.user_id = auth.jwt() ->> 'sub'
        AND v.status = 'passed'
        AND v.date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
        AND v.date_of_birth > (CURRENT_DATE - INTERVAL '121 years')::date
        AND COALESCE(v.failure_code, '') NOT IN ('underage', 'duplicate_identity')
    );
$$;
REVOKE ALL ON FUNCTION public.viewer_is_verified_adult() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_is_verified_adult() TO anon, authenticated, service_role;

-- The caller's public.users id, or NULL. Used for "the author sees their own".
CREATE OR REPLACE FUNCTION public.viewer_user_id()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT u.id FROM public.users u
  WHERE (auth.jwt() ->> 'sub') IS NOT NULL AND u.auth_id = auth.jwt() ->> 'sub';
$$;
REVOKE ALL ON FUNCTION public.viewer_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_user_id() TO anon, authenticated, service_role;

-- True when the post is SPICY and the caller may not see it. Child tables use
-- this rather than a subquery on posts, because that subquery would itself be
-- filtered by the posts policy and read a hidden SPICY post as "not SPICY".
CREATE OR REPLACE FUNCTION public.post_spicy_hidden(p_post_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT NOT public.viewer_is_verified_adult()
    AND EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = p_post_id
        AND p.is_nsfw IS TRUE
        AND p.author_id IS DISTINCT FROM public.viewer_user_id()
    );
$$;
REVOKE ALL ON FUNCTION public.post_spicy_hidden(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_spicy_hidden(bigint) TO anon, authenticated, service_role;

-- RESTRICTIVE, so they narrow the existing permissive policies rather than
-- widen them. The (SELECT ...) wrappers let Postgres evaluate the viewer
-- checks once per statement instead of once per row.
DROP POLICY IF EXISTS spicy_requires_verified_viewer ON public.posts;
CREATE POLICY spicy_requires_verified_viewer ON public.posts AS RESTRICTIVE
  FOR SELECT TO anon, authenticated
  USING (
    is_nsfw IS NOT TRUE
    OR (SELECT public.viewer_is_verified_adult())
    OR author_id = (SELECT public.viewer_user_id())
  );

DROP POLICY IF EXISTS spicy_write_requires_verified_adult ON public.posts;
CREATE POLICY spicy_write_requires_verified_adult ON public.posts AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (is_nsfw IS NOT TRUE OR (SELECT public.viewer_is_verified_adult()));

DROP POLICY IF EXISTS spicy_update_requires_verified_adult ON public.posts;
CREATE POLICY spicy_update_requires_verified_adult ON public.posts AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (is_nsfw IS NOT TRUE OR (SELECT public.viewer_is_verified_adult()));

DROP POLICY IF EXISTS spicy_requires_verified_viewer ON public.posts_media;
CREATE POLICY spicy_requires_verified_viewer ON public.posts_media AS RESTRICTIVE
  FOR SELECT TO anon, authenticated
  USING (NOT public.post_spicy_hidden(_parent_id));

DROP POLICY IF EXISTS spicy_requires_verified_viewer ON public.post_text_slides;
CREATE POLICY spicy_requires_verified_viewer ON public.post_text_slides AS RESTRICTIVE
  FOR SELECT TO anon, authenticated
  USING (NOT public.post_spicy_hidden(post_id));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Operator runbook. Nothing below runs as part of this migration.
--
-- Before switching on: deploy the edge functions from the same commit, so
-- ticket-checkout and cart-checkout no longer consult the gate and
-- add-comment, create-story and update-post do.
--
-- Who enforcement would refuse (every account, no cohort):
--   SELECT count(*) FROM public."user" u
--   WHERE NOT EXISTS (
--     SELECT 1 FROM public.identity_verifications v
--     WHERE v.user_id = u.id AND v.status = 'passed'
--       AND v.date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
--   );
--
-- Switch on, no cohort, no grace:
--   UPDATE public.verified_admission_policy
--   SET enforce = true, cohort_created_after = NULL, grace_deadline = NULL, updated_at = now()
--   WHERE id = 1;
--
-- Optional grace window instead (prompt until the date, refuse after):
--   UPDATE public.verified_admission_policy
--   SET grace_deadline = timestamptz '<ISO instant>', updated_at = now() WHERE id = 1;
--
-- Exempt one account (support escalation, staff):
--   UPDATE public.verified_admission_policy
--   SET allowlist = allowlist || ARRAY['<better-auth-user-id>'], updated_at = now() WHERE id = 1;
--
-- Roll back, instantly and without data loss:
--   UPDATE public.verified_admission_policy SET enforce = false, updated_at = now() WHERE id = 1;
--
-- The SPICY policies in section 3 do not depend on enforce. Rolling them back
-- means dropping the three spicy_* policies on posts and the two on
-- posts_media / post_text_slides.
