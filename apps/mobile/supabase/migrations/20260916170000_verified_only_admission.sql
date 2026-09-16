-- Staged verified-only admission for the existing membership.
--
-- Nothing changes when this is applied: the single policy row ships with
-- enforce = false, no cohort and no deadline, so every account keeps the
-- access it has today. An operator turns the gate on by updating this row.
-- No account is deleted, suspended or orphaned by any state of this table.
BEGIN;

CREATE TABLE IF NOT EXISTS public.verified_admission_policy (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Master switch. false = the gate is inert.
  enforce boolean NOT NULL DEFAULT false,
  -- Accounts created before this instant stay out of scope. NULL = whole membership.
  cohort_created_after timestamptz,
  -- Participation is refused from this instant. NULL = prompt only, never refuse.
  grace_deadline timestamptz,
  -- Better Auth user ids. allowlist stays admitted while enforcement runs;
  -- denylist is in scope whatever cohort_created_after says.
  allowlist text[] NOT NULL DEFAULT '{}',
  denylist text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.verified_admission_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.verified_admission_policy ENABLE ROW LEVEL SECURITY;
-- No policy and no grant: service role only. Clients read their own verdict
-- through verified_admission_context(), which never returns the operator lists.
REVOKE ALL ON TABLE public.verified_admission_policy FROM anon, authenticated;

COMMENT ON TABLE public.verified_admission_policy IS
  'Single-row rollout configuration for verified-only participation. Default is enforcement off.';

-- The caller's own admission inputs. The account comes from the JWT, never
-- from a parameter, so there is no cross-user lookup surface. The client runs
-- the same decideVerifiedAdmission() the edge functions run, on these inputs.
CREATE OR REPLACE FUNCTION public.verified_admission_context()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'userId', sub.id,
    'accountCreatedAt', (SELECT u."createdAt" FROM public."user" u WHERE u.id = sub.id),
    'policy', jsonb_build_object(
      'enforce', p.enforce,
      'cohort_created_after', p.cohort_created_after,
      'grace_deadline', p.grace_deadline
    ),
    'exempt', sub.id = ANY (p.allowlist),
    'denied', sub.id = ANY (p.denylist),
    'record', (
      SELECT jsonb_build_object('user_id', v.user_id, 'status', v.status, 'date_of_birth', v.date_of_birth)
      FROM public.identity_verifications v WHERE v.user_id = sub.id
    )
  )
  FROM public.verified_admission_policy p,
       LATERAL (SELECT NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sub' AS id) sub
  WHERE p.id = 1 AND sub.id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.verified_admission_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verified_admission_context() TO authenticated, service_role;

-- Same decision, expressed for RLS. Returns true whenever the gate is inert,
-- the account is out of the cohort or exempt, still inside grace, or verified
-- with adult document evidence.
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
          WHEN sub.id = ANY (p.denylist) THEN public.is_verified_self() OR p.grace_deadline IS NULL
            OR now() < p.grace_deadline
          WHEN sub.id = ANY (p.allowlist) THEN true
          WHEN p.cohort_created_after IS NOT NULL AND EXISTS (
            SELECT 1 FROM public."user" u
            WHERE u.id = sub.id AND u."createdAt" < p.cohort_created_after
          ) THEN true
          ELSE public.is_verified_self() OR p.grace_deadline IS NULL OR now() < p.grace_deadline
        END
      FROM public.verified_admission_policy p,
           LATERAL (SELECT auth.jwt() ->> 'sub' AS id) sub
      WHERE p.id = 1
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.verified_participation_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verified_participation_allowed() TO anon, authenticated, service_role;

-- Defence in depth. Participation writes already run through edge functions on
-- the service role, which bypasses RLS, so these RESTRICTIVE policies change
-- nothing for them. They close the direct-table path for any client that skips
-- the screen, on whichever of these tables still accepts a client INSERT.
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['posts', 'posts_media', 'post_text_slides', 'stories',
    'comments', 'messages', 'conversations', 'event_rsvps', 'event_comments',
    'event_likes', 'likes', 'tickets', 'ticket_holds'] LOOP
    CONTINUE WHEN to_regclass('public.' || quote_ident(v_table)) IS NULL;
    EXECUTE format('DROP POLICY IF EXISTS verified_participation_boundary ON public.%I', v_table);
    EXECUTE format(
      'CREATE POLICY verified_participation_boundary ON public.%I AS RESTRICTIVE '
      || 'FOR INSERT TO anon, authenticated WITH CHECK (public.verified_participation_allowed())',
      v_table);
  END LOOP;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Operator runbook. Nothing below runs as part of this migration.
--
-- Stage 1, prompt only — banner and deadline, no refusals yet:
--   UPDATE public.verified_admission_policy SET
--     enforce = true,
--     cohort_created_after = timestamptz '2026-01-01 00:00:00+00',
--     grace_deadline = now() + interval '30 days',
--     updated_at = now()
--   WHERE id = 1;
--
-- Stage 2, widen the cohort once stage 1 conversion is known:
--   UPDATE public.verified_admission_policy
--   SET cohort_created_after = NULL, updated_at = now() WHERE id = 1;
--
-- Exempt an account (support escalation, staff, a member mid-appeal):
--   UPDATE public.verified_admission_policy
--   SET allowlist = allowlist || ARRAY['<better-auth-user-id>'], updated_at = now()
--   WHERE id = 1;
--
-- Pull one account in ahead of its cohort:
--   UPDATE public.verified_admission_policy
--   SET denylist = denylist || ARRAY['<better-auth-user-id>'], updated_at = now()
--   WHERE id = 1;
--
-- Roll back, instantly and without data loss:
--   UPDATE public.verified_admission_policy SET enforce = false, updated_at = now() WHERE id = 1;
--
-- Who the next stage would refuse, before switching it on:
--   SELECT count(*) FROM public."user" u
--   WHERE u."createdAt" >= timestamptz '2026-01-01 00:00:00+00'
--     AND NOT EXISTS (
--       SELECT 1 FROM public.identity_verifications v
--       WHERE v.user_id = u.id AND v.status = 'passed'
--         AND v.date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
--     );
