-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519194624 :: notifications_ticket_comp_and_refund_types). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'ticket_comped';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'ticket_refunded';;
