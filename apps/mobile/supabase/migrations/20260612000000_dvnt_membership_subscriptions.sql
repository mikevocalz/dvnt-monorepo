-- DVNT Membership subscriptions + standalone Sneaky Lynk tier refresh.
--
-- Adds the DVNT Membership family (Core / Insider / VIP / Founders Circle)
-- alongside the existing sneaky_subscriptions table. Non-destructive: existing
-- sneaky_subscriptions rows and their plans are untouched. The app resolves
-- effective entitlements from BOTH tables (membership supersedes Sneaky-only)
-- via packages/app/lib/subscription/entitlements.ts.
--
-- Stripe price ids are NOT stored here — the server maps plan_key → price via
-- env (STRIPE_PRICE_DVNT_CORE, …). membership_plans documents which env var.

-- ── Reference: membership/sneaky plan catalog (mirrors lib/subscription/plans.ts) ──
CREATE TABLE IF NOT EXISTS membership_plans (
  plan_key text PRIMARY KEY,
  product_family text NOT NULL CHECK (product_family IN ('sneaky_lynk','dvnt_membership')),
  name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  -- Name of the server env var holding this plan's Stripe price id (null = free).
  stripe_price_env text,
  recommended boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

INSERT INTO membership_plans (plan_key, product_family, name, price_cents, stripe_price_env, recommended, sort_order) VALUES
  ('free',                 'dvnt_membership', 'Free',            0,     NULL,                        false, 0),
  ('sneaky_tier_1',        'sneaky_lynk',     'Sneaky Tier 1',   999,   'STRIPE_PRICE_SNEAKY_TIER_1', false, 1),
  ('sneaky_tier_2',        'sneaky_lynk',     'Sneaky Tier 2',   1499,  'STRIPE_PRICE_SNEAKY_TIER_2', false, 2),
  ('dvnt_core',            'dvnt_membership', 'Core',            2500,  'STRIPE_PRICE_DVNT_CORE',     false, 3),
  ('dvnt_insider',         'dvnt_membership', 'Insider',         5000,  'STRIPE_PRICE_DVNT_INSIDER',  false, 4),
  ('dvnt_vip',             'dvnt_membership', 'VIP',             7500,  'STRIPE_PRICE_DVNT_VIP',      true,  5),
  ('dvnt_founders_circle', 'dvnt_membership', 'Founders Circle', 15000, 'STRIPE_PRICE_DVNT_FOUNDERS', false, 6)
ON CONFLICT (plan_key) DO UPDATE SET
  product_family = EXCLUDED.product_family,
  name = EXCLUDED.name,
  price_cents = EXCLUDED.price_cents,
  stripe_price_env = EXCLUDED.stripe_price_env,
  recommended = EXCLUDED.recommended,
  sort_order = EXCLUDED.sort_order;

-- ── Per-user membership subscription (one active row per user) ──
CREATE TABLE IF NOT EXISTS membership_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,
  product_family text NOT NULL DEFAULT 'dvnt_membership'
    CHECK (product_family IN ('sneaky_lynk','dvnt_membership')),
  plan_key text NOT NULL REFERENCES membership_plans(plan_key),
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('active','trialing','past_due','canceled','incomplete','inactive')),
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  stripe_price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  canceled_at timestamptz,
  -- Dunning grace window for past_due before paid access is revoked.
  grace_period_ends_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  -- Optional cached resolver output for fast reads / audit.
  entitlement_snapshot jsonb,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_membership_subs_user ON membership_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_membership_subs_stripe ON membership_subscriptions(stripe_subscription_id);

-- ── Audit trail of subscription lifecycle events (idempotent via webhook id) ──
CREATE TABLE IF NOT EXISTS membership_subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  stripe_event_id text UNIQUE,
  stripe_subscription_id text,
  kind text NOT NULL,
  from_plan_key text,
  to_plan_key text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

-- ── RLS: a member can read their own subscription; writes are service-role only ──
ALTER TABLE membership_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "membership_plans_read" ON membership_plans;
CREATE POLICY "membership_plans_read" ON membership_plans
  FOR SELECT TO authenticated USING (active = true);

ALTER TABLE membership_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "membership_subs_own" ON membership_subscriptions;
-- Better Auth user id arrives in the JWT `sub` claim (same pattern as
-- sneaky_subscriptions / video_room_invites). Not Supabase auth.uid().
CREATE POLICY "membership_subs_own" ON membership_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

ALTER TABLE membership_subscription_events ENABLE ROW LEVEL SECURITY;
-- No authenticated policy → only the service role (webhook) reads/writes events.

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION set_membership_subs_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_membership_subs_updated_at ON membership_subscriptions;
CREATE TRIGGER trg_membership_subs_updated_at
  BEFORE UPDATE ON membership_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_membership_subs_updated_at();

-- Grants (RLS still applies). authenticated reads its own rows; service role (webhook) writes.
GRANT SELECT ON membership_plans TO authenticated;
GRANT SELECT ON membership_subscriptions TO authenticated;
GRANT ALL ON membership_plans TO service_role;
GRANT ALL ON membership_subscriptions TO service_role;
GRANT ALL ON membership_subscription_events TO service_role;
