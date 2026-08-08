-- ══════════════════════════════════════════════════════════════
-- WS-6 payouts: persist Stripe Connect account requirements
-- ══════════════════════════════════════════════════════════════
-- account.updated previously stored only the three capability booleans
-- (charges_enabled / payouts_enabled / details_submitted). The payout /
-- organizer-setup UI needs the ACTIONABLE requirement state to render a
-- "what's blocking your payouts" checklist without a live Stripe
-- retrieve. These columns mirror the Stripe Account.requirements hash:
--   • currently_due / past_due  → jsonb arrays of requirement ids (string[])
--   • disabled_reason           → text (e.g. 'requirements.past_due'), or null
--   • current_deadline          → timestamptz (Stripe sends unix seconds;
--                                 the webhook converts to ISO before write)
-- All nullable: an account with nothing outstanding has [] arrays and NULL
-- reason/deadline. Written by the stripe-webhook account.updated handler,
-- guarded by the existing `.eq('stripe_account_id', account.id)` update
-- path — idempotent (last-write-wins on each account.updated event).

ALTER TABLE public.organizer_accounts
  ADD COLUMN IF NOT EXISTS requirements_currently_due    jsonb,
  ADD COLUMN IF NOT EXISTS requirements_past_due         jsonb,
  ADD COLUMN IF NOT EXISTS requirements_disabled_reason  text,
  ADD COLUMN IF NOT EXISTS requirements_current_deadline timestamptz;

NOTIFY pgrst, 'reload schema';
