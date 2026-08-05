-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260612044638 :: event_membership_gating). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Event membership gating flags.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_dvnt_produced boolean NOT NULL DEFAULT false;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS partner_discount_eligible boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_events_produced ON events(is_dvnt_produced)
  WHERE is_dvnt_produced = true;

COMMENT ON COLUMN events.is_dvnt_produced IS
  'True for DVNT-produced events. Access is gated by membership tier allowance (Core 1/quarter, Insider 1/month, VIP+ any). Partner/standard events stay open.';
COMMENT ON COLUMN events.partner_discount_eligible IS
  'True if this partner event is eligible for membership partner discounts (Founders Circle).';;
