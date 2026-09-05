-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260617164435 :: content_reports_attachments). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

alter table public.content_reports
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.content_reports.attachments is
  'Array of evidence image URLs (Supabase Storage) attached by the reporter.';;
