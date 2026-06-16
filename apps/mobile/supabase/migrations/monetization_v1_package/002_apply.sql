-- ============================================================
-- DVNT Monetization V1 — Apply
-- Additive only: no columns dropped, no existing data modified
-- Run in Supabase SQL Editor. All guards are idempotent.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. events.event_type
-- ══════════════════════════════════════════════════════════════
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type text;

DO $$ BEGIN
  ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK (
    event_type IS NULL OR event_type IN (
      'virtual_session','party','picnic','game_night','panel','happy_hour',
      'wine_down','kickback','ball','kiki','pool_party','spoken_word',
      'open_mic','karaoke','bike_ride','walk_run','fitness_training','yoga',
      'meditation','bate_session','sex_party','kink_fetish_party',
      'training','cooking_class','mixology','dance_class','other'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 2. orders — fee component columns + quantity
-- ══════════════════════════════════════════════════════════════
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_pct_fee_cents integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_per_ticket_fee_cents integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_fee_cents integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS org_pct_fee_cents integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS org_per_ticket_fee_cents integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS organizer_fee_cents integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dvnt_total_fee_cents integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fee_policy_version text DEFAULT 'v1_250_1pt';

-- Update orders.type CHECK to include sneaky_subscription
-- Drop the old inline constraint and recreate it
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_type_check;
DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_type_check
    CHECK (type IN ('event_ticket','promotion','sneaky_access','sneaky_subscription'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 3. promo_codes (organizer discount codes per ticket type)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_type_id uuid REFERENCES ticket_types(id) ON DELETE CASCADE,
  code text NOT NULL,
  discount_type text NOT NULL DEFAULT 'percent'
    CHECK (discount_type IN ('percent','fixed_cents')),
  discount_value integer NOT NULL,
  max_uses integer,
  uses_count integer DEFAULT 0,
  valid_from timestamptz,
  valid_until timestamptz,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_event_code
  ON promo_codes(event_id, UPPER(code));
CREATE INDEX IF NOT EXISTS idx_promo_codes_event ON promo_codes(event_id);

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promo_codes_select_public" ON promo_codes;
CREATE POLICY "promo_codes_select_public" ON promo_codes FOR SELECT USING (true);

DROP POLICY IF EXISTS "promo_codes_insert_host" ON promo_codes;
CREATE POLICY "promo_codes_insert_host" ON promo_codes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = promo_codes.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

DROP POLICY IF EXISTS "promo_codes_update_host" ON promo_codes;
CREATE POLICY "promo_codes_update_host" ON promo_codes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = promo_codes.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

GRANT SELECT ON promo_codes TO authenticated;
GRANT INSERT, UPDATE ON promo_codes TO authenticated;
GRANT ALL ON promo_codes TO service_role;

-- ══════════════════════════════════════════════════════════════
-- 4. sneaky_subscription_plans (Stripe product/price catalog)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sneaky_subscription_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL DEFAULT 0,
  interval text NOT NULL DEFAULT 'month'
    CHECK (interval IN ('month','year')),
  max_participants integer NOT NULL DEFAULT 5,
  max_duration_minutes integer,
  stripe_product_id text,
  stripe_price_id text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sneaky_subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sneaky_plans_select" ON sneaky_subscription_plans;
CREATE POLICY "sneaky_plans_select" ON sneaky_subscription_plans
  FOR SELECT USING (active = true);

GRANT SELECT ON sneaky_subscription_plans TO authenticated;
GRANT ALL ON sneaky_subscription_plans TO service_role;

-- Seed plans (idempotent)
INSERT INTO sneaky_subscription_plans (id, name, description, price_cents, interval, max_participants, max_duration_minutes)
VALUES
  ('free',    'Free',    'Up to 5 participants, 5 min max per session', 0,     'month', 5,  5),
  ('host_25', 'Host 25', 'Up to 25 participants, unlimited duration',   1499,  'month', 25, NULL),
  ('host_50', 'Host 50', 'Up to 50 participants, unlimited duration',   2499,  'month', 50, NULL)
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 5. sneaky_subscriptions (per-host active subscription)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sneaky_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id text NOT NULL UNIQUE,
  plan_id text NOT NULL REFERENCES sneaky_subscription_plans(id),
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('active','trialing','past_due','canceled','inactive')),
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  stripe_price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  canceled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sneaky_subs_host ON sneaky_subscriptions(host_id);
CREATE INDEX IF NOT EXISTS idx_sneaky_subs_stripe_id ON sneaky_subscriptions(stripe_subscription_id);

ALTER TABLE sneaky_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sneaky_subs_own" ON sneaky_subscriptions;
CREATE POLICY "sneaky_subs_own" ON sneaky_subscriptions FOR ALL
  USING (host_id = current_setting('request.jwt.claims', true)::json->>'sub');

GRANT SELECT ON sneaky_subscriptions TO authenticated;
GRANT ALL ON sneaky_subscriptions TO service_role;

-- ══════════════════════════════════════════════════════════════
-- 6. Reload schema cache
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
