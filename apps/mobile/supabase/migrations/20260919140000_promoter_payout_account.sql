-- ══════════════════════════════════════════════════════════════
-- Phase 3: promoter payout onboarding
--
-- Adds Stripe Connect account tracking to event_promoters so a promoter
-- (linked or external) can receive their commission earnings. Reuses the
-- organizer onboarding flow where the same identity already has an
-- organizer_accounts row.
--
-- Connect account status is synced from Stripe account.updated webhooks
-- and from the promoter-connect "status" action.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE event_promoters
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS charges_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payouts_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS details_submitted boolean DEFAULT false;

-- Grant so edge functions can read/update promoter connect state.
GRANT ALL ON event_promoters TO service_role;

NOTIFY pgrst, 'reload schema';
