-- Event membership gating flags.
--
-- Distinguishes DVNT-produced events (gated by membership tier allowance) from
-- partner/standard events (open; eligible for partner discounts only when
-- flagged). Used by packages/app/lib/subscription/entitlements.ts
-- (canAccessProducedEvent / appliesPartnerDiscount). Defaults preserve current
-- behavior: every existing event is non-produced (open) until an organizer/admin
-- marks it produced.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_dvnt_produced boolean NOT NULL DEFAULT false;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS partner_discount_eligible boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_events_produced ON events(is_dvnt_produced)
  WHERE is_dvnt_produced = true;

COMMENT ON COLUMN events.is_dvnt_produced IS
  'True for DVNT-produced events. Access is gated by membership tier allowance (Core 1/quarter, Insider 1/month, VIP+ any). Partner/standard events stay open.';
COMMENT ON COLUMN events.partner_discount_eligible IS
  'True if this partner event is eligible for membership partner discounts (Founders Circle).';
