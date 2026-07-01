-- D2: rail + provider_ref + monotonic guard on membership_subscriptions,
-- plus a single is_entitled() RPC so web and native read entitlement the
-- same way (I3). RevenueCat mobile rows + Stripe web rows now coexist in
-- one table, distinguished by `rail`.
--
-- Trade-off / failure mode defended against:
--   I5 — without `last_event_at`, an out-of-order webhook replay can
--   silently overwrite a newer state ("canceled" lands after "active"
--   for the same subscription_id → user revoked incorrectly). The
--   monotonic guard on stripe-webhook + revenuecat-webhook now reads
--   this column before writing.

-- ── Rail + normalised provider id + monotonic guard ─────────────────
ALTER TABLE membership_subscriptions
  ADD COLUMN IF NOT EXISTS rail text NOT NULL DEFAULT 'web_stripe'
    CHECK (rail IN ('web_stripe','ios_iap','play_iap')),
  ADD COLUMN IF NOT EXISTS provider_ref text,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

-- Backfill: existing rows all came in via the Stripe webhook.
UPDATE membership_subscriptions
SET
  provider_ref = COALESCE(provider_ref, stripe_subscription_id),
  last_event_at = COALESCE(last_event_at, updated_at)
WHERE provider_ref IS NULL OR last_event_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_membership_subs_rail
  ON membership_subscriptions(rail);
CREATE INDEX IF NOT EXISTS idx_membership_subs_provider_ref
  ON membership_subscriptions(provider_ref);

-- ── Single entitlement resolver (I3) ────────────────────────────────
-- Two RPCs, one truth:
--   is_entitled_self()   — SECURITY INVOKER; the client reads their own
--                          row via RLS. Silences the Supabase
--                          `authenticated_security_definer_function_executable`
--                          advisor and prevents any cross-user lookup by
--                          construction (no parameter to pass another uid).
--   is_entitled(uid)     — service-role-only; edge functions use this
--                          during webhook reconciliation to check a
--                          different user's entitlement. GRANTED ONLY
--                          to service_role so a signed-in client cannot
--                          enumerate other users' plan tiers.
CREATE OR REPLACE FUNCTION public.is_entitled_self()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT plan_key
  FROM membership_subscriptions
  WHERE user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub')
    AND (
      (status IN ('active','trialing')
        AND (current_period_end IS NULL OR current_period_end > now()))
      OR (status = 'past_due'
        AND grace_period_ends_at IS NOT NULL
        AND grace_period_ends_at > now())
    )
  ORDER BY current_period_end DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.is_entitled_self() FROM public;
GRANT EXECUTE ON FUNCTION public.is_entitled_self() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_entitled(uid text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT plan_key
  FROM membership_subscriptions
  WHERE user_id = uid
    AND (
      (status IN ('active','trialing')
        AND (current_period_end IS NULL OR current_period_end > now()))
      OR (status = 'past_due'
        AND grace_period_ends_at IS NOT NULL
        AND grace_period_ends_at > now())
    )
  ORDER BY current_period_end DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.is_entitled(text) FROM public;
GRANT EXECUTE ON FUNCTION public.is_entitled(text) TO service_role;

-- ── Monotonic upsert helper used by both webhooks (I5) ─────────────
-- A delayed/replayed event with an older `event_created_at` is a no-op:
-- the row stays at whatever newer state was already written. Avoids the
-- Supabase JS `.upsert()` race where we'd otherwise need two round-trips.
CREATE OR REPLACE FUNCTION public.upsert_membership_subscription(
  p_user_id              text,
  p_rail                 text,
  p_product_family       text,
  p_plan_key             text,
  p_status               text,
  p_provider_ref         text,
  p_stripe_customer_id   text,
  p_stripe_subscription_id text,
  p_stripe_price_id      text,
  p_current_period_start timestamptz,
  p_current_period_end   timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at          timestamptz,
  p_event_created_at     timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_applied boolean;
BEGIN
  INSERT INTO membership_subscriptions (
    user_id, rail, product_family, plan_key, status,
    provider_ref, stripe_customer_id, stripe_subscription_id, stripe_price_id,
    current_period_start, current_period_end,
    cancel_at_period_end, canceled_at,
    last_event_at, last_synced_at, updated_at
  )
  VALUES (
    p_user_id, p_rail, p_product_family, p_plan_key, p_status,
    p_provider_ref, p_stripe_customer_id, p_stripe_subscription_id, p_stripe_price_id,
    p_current_period_start, p_current_period_end,
    coalesce(p_cancel_at_period_end, false), p_canceled_at,
    p_event_created_at, now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    rail                   = EXCLUDED.rail,
    product_family         = EXCLUDED.product_family,
    plan_key               = EXCLUDED.plan_key,
    status                 = EXCLUDED.status,
    provider_ref           = EXCLUDED.provider_ref,
    stripe_customer_id     = EXCLUDED.stripe_customer_id,
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    stripe_price_id        = EXCLUDED.stripe_price_id,
    current_period_start   = EXCLUDED.current_period_start,
    current_period_end     = EXCLUDED.current_period_end,
    cancel_at_period_end   = EXCLUDED.cancel_at_period_end,
    canceled_at            = EXCLUDED.canceled_at,
    last_event_at          = EXCLUDED.last_event_at,
    last_synced_at         = EXCLUDED.last_synced_at,
    updated_at             = EXCLUDED.updated_at
  WHERE membership_subscriptions.last_event_at IS NULL
     OR membership_subscriptions.last_event_at < EXCLUDED.last_event_at;

  -- TRUE if the row was inserted or its last_event_at moved forward.
  GET DIAGNOSTICS v_applied = ROW_COUNT;
  RETURN v_applied;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_membership_subscription(
  text, text, text, text, text, text, text, text, text,
  timestamptz, timestamptz, boolean, timestamptz, timestamptz
) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_membership_subscription(
  text, text, text, text, text, text, text, text, text,
  timestamptz, timestamptz, boolean, timestamptz, timestamptz
) TO service_role;

-- ── RevenueCat event dedup table (parallel to stripe_events) ────────
-- Same pattern: one row per RC event id. Insert-or-skip = idempotent.
CREATE TABLE IF NOT EXISTS rc_events (
  event_id text PRIMARY KEY,
  app_user_id text,
  event_type text NOT NULL,
  product_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_rc_events_app_user
  ON rc_events(app_user_id);
