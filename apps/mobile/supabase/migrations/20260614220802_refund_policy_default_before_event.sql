-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260614220802 :: refund_policy_default_before_event). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- The platform's existing behavior allowed self-refunds any time BEFORE the
-- event started. Default 'none' would silently make every existing event
-- non-refundable — regressing tickets already sold under that expectation. Use
-- 'before_event' as the behavior-preserving default and backfill the rows that
-- got the placeholder 'none' from the (brand-new) column.
alter table public.events alter column refund_policy set default 'before_event';
update public.events set refund_policy = 'before_event' where refund_policy = 'none';;
