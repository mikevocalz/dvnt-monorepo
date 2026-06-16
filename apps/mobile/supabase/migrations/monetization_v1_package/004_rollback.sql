-- ============================================================
-- DVNT Monetization V1 — Rollback
-- Drops ONLY the tables/columns added by 002_apply.sql
-- Does NOT touch pre-existing tables or columns
-- ============================================================

-- 1. Drop new tables in dependency order
DROP TABLE IF EXISTS sneaky_subscriptions CASCADE;
DROP TABLE IF EXISTS sneaky_subscription_plans CASCADE;
DROP TABLE IF EXISTS promo_codes CASCADE;

-- 2. Remove fee component columns from orders
ALTER TABLE orders DROP COLUMN IF EXISTS quantity;
ALTER TABLE orders DROP COLUMN IF EXISTS buyer_pct_fee_cents;
ALTER TABLE orders DROP COLUMN IF EXISTS buyer_per_ticket_fee_cents;
ALTER TABLE orders DROP COLUMN IF EXISTS buyer_fee_cents;
ALTER TABLE orders DROP COLUMN IF EXISTS org_pct_fee_cents;
ALTER TABLE orders DROP COLUMN IF EXISTS org_per_ticket_fee_cents;
ALTER TABLE orders DROP COLUMN IF EXISTS organizer_fee_cents;
ALTER TABLE orders DROP COLUMN IF EXISTS dvnt_total_fee_cents;
ALTER TABLE orders DROP COLUMN IF EXISTS fee_policy_version;

-- 3. Revert orders.type CHECK constraint to original
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_type_check;
DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_type_check
    CHECK (type IN ('event_ticket','promotion','sneaky_access'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Remove event_type from events
ALTER TABLE events DROP COLUMN IF EXISTS event_type;

NOTIFY pgrst, 'reload schema';
