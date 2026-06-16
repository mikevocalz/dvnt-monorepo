-- ══════════════════════════════════════════════════════════════
-- Phase 3: Subscription Hardening
-- Adds grace_period_ends_at for past_due enforcement
-- ══════════════════════════════════════════════════════════════

-- 1. Add grace_period_ends_at column
ALTER TABLE sneaky_subscriptions
  ADD COLUMN IF NOT EXISTS grace_period_ends_at timestamptz;

-- 2. Reload schema cache
NOTIFY pgrst, 'reload schema';
