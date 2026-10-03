-- Restricted profiles from guest checkout (checklist A01, A04, T05, R05-R07).
--
-- A guest who buys or RSVPs gives us a username, full name, email and phone.
-- After the ticket is issued, the server creates a profile for that email, or
-- reuses the one that already exists. Nothing here marks anyone verified:
-- "user"."emailVerified" and users.verified both start false, and a
-- checkout-created profile cannot post, comment, message or join rooms until
-- an identity_verifications row passes with adult document evidence.
--
-- Everything is server-side. Every function below is SECURITY DEFINER with
-- EXECUTE for service_role only, and the two new tables have RLS on with no
-- policy and no anon/authenticated grant. Clients never write a profile row.
--
-- Contact privacy. Phone and full name live in user_private_profile, which no
-- client role can read. The email has to live in "user".email (Better Auth
-- signs in by it) and users.email (NOT NULL, unique). Both columns are
-- readable by anon today through table grants and "viewable by everyone"
-- policies on every existing account. This migration does not change that,
-- and it keeps the full name out of every public column: "user".name gets the
-- username and users.first_name/last_name stay null.

BEGIN;

-- ── Private contact and identity fields ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_private_profile (
  auth_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  full_name text,
  phone_e164 text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- 'checkout': created by ensure_checkout_profile without a date of birth.
  source text NOT NULL CHECK (source IN ('checkout')),
  -- Locked out of participation until verified. Never flipped by hand:
  -- is_checkout_restricted() reads verification state, so passing ID
  -- verification is what unlocks the account.
  checkout_restricted boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email_normalized = lower(btrim(email_normalized)))
);
CREATE UNIQUE INDEX IF NOT EXISTS user_private_profile_email_key
  ON public.user_private_profile (email_normalized);

ALTER TABLE public.user_private_profile ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_private_profile FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_private_profile TO service_role;

COMMENT ON TABLE public.user_private_profile IS
  'Phone and full name captured at guest checkout. Service role only; never exposed to anon or authenticated.';

-- ── Pending profile fields for paid checkouts ───────────────────────────────
-- A paid checkout redirects to Stripe before anything is issued, so the
-- fields wait here, keyed by the Checkout Session id, until the webhook issues
-- the tickets. Finalizing nulls the personal fields. Rows for abandoned
-- sessions are deleted by the next intake after seven days.
CREATE TABLE IF NOT EXISTS public.checkout_profile_intake (
  checkout_ref text PRIMARY KEY,
  email_normalized text NOT NULL,
  username text,
  full_name text,
  phone_e164 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  result jsonb
);
CREATE INDEX IF NOT EXISTS checkout_profile_intake_pending_idx
  ON public.checkout_profile_intake (created_at) WHERE finalized_at IS NULL;

ALTER TABLE public.checkout_profile_intake ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_profile_intake FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.checkout_profile_intake TO service_role;

-- ── Username availability ──────────────────────────────────────────────────
-- Case-insensitive across both tables: Better Auth stores lowercase, but 21
-- legacy public.users rows carry mixed case (read-only check, 2026-10-03).
-- The reserved list matches RESERVED_USERNAMES in checkout-profile-fields.ts.
CREATE OR REPLACE FUNCTION public.checkout_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_username IS NOT NULL
    AND p_username ~ '^[a-z0-9_.]{3,30}$'
    AND p_username !~ '(^\.|\.$|\.\.)'
    AND p_username <> ALL (ARRAY[
      'admin', 'administrator', 'deviant', 'deviantevents', 'dvnt', 'dvntapp',
      'help', 'moderator', 'official', 'root', 'security', 'staff', 'support',
      'system'
    ])
    AND NOT EXISTS (SELECT 1 FROM public."user" u WHERE lower(u.username) = p_username)
    AND NOT EXISTS (SELECT 1 FROM public.users u WHERE lower(u.username) = p_username);
$$;

-- ── Restricted-profile test used by every participation gate ────────────────
CREATE OR REPLACE FUNCTION public.is_checkout_restricted(p_auth_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_private_profile p
    WHERE p.auth_id = p_auth_id AND p.checkout_restricted
  ) AND NOT EXISTS (
    SELECT 1 FROM public.identity_verifications v
    WHERE v.user_id = p_auth_id
      AND v.status = 'passed'
      AND v.date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
      AND v.date_of_birth > (CURRENT_DATE - INTERVAL '121 years')::date
  );
$$;

-- ── Create or reuse ────────────────────────────────────────────────────────
-- Keyed by email, case-insensitively. Concurrent checkouts for one email
-- serialize on a transaction-scoped advisory lock; the unique indexes on
-- "user".email, users.email, users.username and "user".username are the
-- backstop when a signup races in without taking the lock.
--
-- Reuse never edits the existing account: no username, name or phone typed at
-- checkout is written onto it, because whoever typed them has not proved they
-- own the address. Tickets attach to a reused account only when its email is
-- already verified, which is claim_guest_orders' contract. Everything else
-- attaches on the buyer's first magic-link sign-in, as before.
CREATE OR REPLACE FUNCTION public.ensure_checkout_profile(
  p_email text,
  p_username text,
  p_full_name text,
  p_phone_e164 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_name text := nullif(regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), '');
  v_phone text := nullif(btrim(coalesce(p_phone_e164, '')), '');
  v_auth_id text;
  v_email_verified boolean;
  v_member_id integer;
  v_candidate text;
  v_attempt integer := 0;
  v_claim jsonb;
BEGIN
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('checkout_profile:' || v_email, 0));

  <<attempt>>
  LOOP
    SELECT u.id, u."emailVerified" INTO v_auth_id, v_email_verified
    FROM public."user" u WHERE lower(u.email) = v_email LIMIT 1;

    IF v_auth_id IS NOT NULL THEN
      SELECT m.id INTO v_member_id FROM public.users m WHERE m.auth_id = v_auth_id;
      IF v_email_verified THEN
        v_claim := public.claim_guest_orders(v_auth_id, v_email);
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'status', 'reused',
        'authId', v_auth_id,
        'memberId', v_member_id,
        'attached', coalesce(v_email_verified, false),
        'claim', v_claim
      );
    END IF;

    -- A profile row with no Better Auth login: an imported legacy account.
    -- auth-sync links it by email on that person's first sign-in, so a
    -- second login must not be minted beside it.
    SELECT m.id INTO v_member_id FROM public.users m WHERE lower(m.email) = v_email LIMIT 1;
    IF v_member_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true, 'status', 'reused_legacy', 'authId', NULL,
        'memberId', v_member_id, 'attached', false
      );
    END IF;

    IF v_username !~ '^[a-z0-9_.]{3,30}$' OR v_username ~ '(^\.|\.$|\.\.)' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_username');
    END IF;
    IF v_name IS NULL OR length(v_name) > 120 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_full_name');
    END IF;
    IF v_phone IS NULL OR v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_phone');
    END IF;

    -- The chosen name was checked live at checkout, but a paid checkout
    -- finalizes after Stripe returns, and someone may have taken it since. The
    -- buyer has paid, so pick the nearest free variant instead of failing.
    v_candidate := CASE
      WHEN v_attempt = 0 THEN v_username
      ELSE left(v_username, 30 - length(v_attempt::text) - 1) || '_' || v_attempt::text
    END;

    IF public.checkout_username_available(v_candidate) THEN
      BEGIN
        v_auth_id := replace(gen_random_uuid()::text, '-', '');
        INSERT INTO public."user"
          (id, name, email, "emailVerified", username, "displayUsername", "createdAt", "updatedAt")
        VALUES
          (v_auth_id, v_candidate, v_email, false, v_candidate, v_candidate, now(), now());

        INSERT INTO public.users
          (auth_id, email, username, verified, followers_count, following_count, posts_count)
        VALUES
          (v_auth_id, v_email, v_candidate, false, 0, 0, 0)
        RETURNING id INTO v_member_id;

        INSERT INTO public.user_private_profile
          (auth_id, email_normalized, full_name, phone_e164, source, checkout_restricted)
        VALUES
          (v_auth_id, v_email, v_name, v_phone, 'checkout', true);

        RETURN jsonb_build_object(
          'ok', true,
          'status', 'created',
          'authId', v_auth_id,
          'memberId', v_member_id,
          'username', v_candidate,
          'usernameAdjusted', v_candidate <> v_username,
          'attached', false
        );
      EXCEPTION WHEN unique_violation THEN
        -- Either the email arrived through a path that does not take the
        -- lock (signup), which the next pass reuses, or the username went in
        -- the meantime, which the next pass walks past.
        v_auth_id := NULL;
        v_member_id := NULL;
      END;
    END IF;

    v_attempt := v_attempt + 1;
    IF v_attempt > 50 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'username_unavailable');
    END IF;
  END LOOP attempt;
END;
$$;

-- ── Paid-checkout intake and finalize ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_checkout_profile_intake(
  p_checkout_ref text,
  p_email text,
  p_username text,
  p_full_name text,
  p_phone_e164 text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_checkout_ref IS NULL OR btrim(p_checkout_ref) = '' THEN
    RAISE EXCEPTION 'a checkout reference is required';
  END IF;

  DELETE FROM public.checkout_profile_intake
  WHERE finalized_at IS NULL AND created_at < now() - interval '7 days';

  INSERT INTO public.checkout_profile_intake
    (checkout_ref, email_normalized, username, full_name, phone_e164)
  VALUES
    (p_checkout_ref, lower(btrim(p_email)), p_username, p_full_name, p_phone_e164)
  ON CONFLICT (checkout_ref) DO NOTHING;
END;
$$;

-- Idempotent: the Stripe webhook and the reconcile sweep can both call it for
-- one session, and only the first does anything.
CREATE OR REPLACE FUNCTION public.finalize_checkout_profile(p_checkout_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intake public.checkout_profile_intake%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_intake FROM public.checkout_profile_intake
  WHERE checkout_ref = p_checkout_ref FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'status', 'no_intake');
  END IF;
  IF v_intake.finalized_at IS NOT NULL THEN
    RETURN coalesce(v_intake.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;

  v_result := public.ensure_checkout_profile(
    v_intake.email_normalized, v_intake.username, v_intake.full_name, v_intake.phone_e164
  );

  UPDATE public.checkout_profile_intake
  SET finalized_at = now(),
      result = v_result,
      username = NULL,
      full_name = NULL,
      phone_e164 = NULL
  WHERE checkout_ref = p_checkout_ref;

  RETURN v_result;
END;
$$;

-- ── Onboarding hooks that live on other branches ───────────────────────────
-- enqueue_brand_onboarding, ensure_brand_follow_relationships and
-- enqueue_first_post_prompt(text) RETURNS integer ship with the
-- @DeviantEvents onboarding work (20261001194000 on
-- workstream/02-deviantevents-onboarding-retention). Each call is skipped
-- when its function is missing, so this
-- migration applies before, after or without them. A failure inside one is
-- reported in the result and never undoes the profile or the ticket.
CREATE OR REPLACE FUNCTION public.run_new_profile_onboarding(
  p_auth_id text,
  p_member_id integer,
  p_brand_id integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enqueue text := 'missing';
  v_follow text := 'missing';
BEGIN
  IF to_regprocedure('public.enqueue_brand_onboarding(text, interval, interval)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT public.enqueue_brand_onboarding($1, $2, $3)'
        USING p_auth_id, interval '7 days', interval '24 hours';
      v_enqueue := 'ok';
    EXCEPTION
      WHEN undefined_function THEN v_enqueue := 'missing';
      WHEN OTHERS THEN v_enqueue := 'error:' || SQLSTATE;
    END;
  END IF;

  IF p_brand_id IS NULL OR p_member_id IS NULL THEN
    v_follow := 'no_brand';
  ELSIF to_regprocedure('public.ensure_brand_follow_relationships(integer, integer, boolean, interval)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT public.ensure_brand_follow_relationships($1, $2, $3, $4)'
        USING p_member_id, p_brand_id, true, interval '7 days';
      v_follow := 'ok';
    EXCEPTION
      WHEN undefined_function THEN v_follow := 'missing';
      WHEN OTHERS THEN v_follow := 'error:' || SQLSTATE;
    END;
  END IF;

  RETURN jsonb_build_object('enqueue', v_enqueue, 'follow', v_follow);
END;
$$;

CREATE OR REPLACE FUNCTION public.run_verified_onboarding(p_auth_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prompt text := 'missing';
BEGIN
  IF to_regprocedure('public.enqueue_first_post_prompt(text)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT public.enqueue_first_post_prompt($1)' USING p_auth_id;
      v_prompt := 'ok';
    EXCEPTION
      WHEN undefined_function THEN v_prompt := 'missing';
      WHEN OTHERS THEN v_prompt := 'error:' || SQLSTATE;
    END;
  END IF;
  RETURN jsonb_build_object('firstPostPrompt', v_prompt);
END;
$$;

-- ── The RLS boundary learns about restricted profiles ──────────────────────
-- Same body as 20260916170000 plus one branch: a checkout-created profile is
-- refused before the rollout switch is read, so it stays locked while
-- verified_admission_policy.enforce is false.
CREATE OR REPLACE FUNCTION public.verified_participation_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role' THEN true
    ELSE (
      SELECT
        CASE
          WHEN EXISTS (
            SELECT 1 FROM public.identity_verifications v
            WHERE v.user_id = sub.id AND v.date_of_birth IS NOT NULL
              AND v.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
          ) THEN false
          WHEN sub.id IS NOT NULL AND public.is_checkout_restricted(sub.id) THEN false
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

-- The client banner reads the same flag, so a restricted buyer sees the
-- verification prompt the server will enforce.
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
    'restricted', public.is_checkout_restricted(sub.id),
    'record', (
      SELECT jsonb_build_object('user_id', v.user_id, 'status', v.status, 'date_of_birth', v.date_of_birth)
      FROM public.identity_verifications v WHERE v.user_id = sub.id
    )
  )
  FROM public.verified_admission_policy p,
       LATERAL (SELECT NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sub' AS id) sub
  WHERE p.id = 1 AND sub.id IS NOT NULL;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.checkout_username_available(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_checkout_restricted(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_checkout_profile(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_checkout_profile_intake(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_checkout_profile(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_new_profile_onboarding(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_verified_onboarding(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.checkout_username_available(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_checkout_restricted(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_checkout_profile(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_checkout_profile_intake(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_checkout_profile(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_new_profile_onboarding(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_verified_onboarding(text) TO service_role;

-- Unchanged from 20260916170000: both stay callable where they were.
REVOKE ALL ON FUNCTION public.verified_participation_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verified_participation_allowed() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verified_admission_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verified_admission_context() TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
