-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260618005518 :: members_profile_fields). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Make member (app user) profile fields editable in Payload, writing back to
-- public.users. Additive columns on members + its versions table, mirroring the
-- Payload camelCase->snake_case convention (firstName->first_name, etc.).
alter table payload.members
  add column if not exists first_name text,
  add column if not exists last_name  text,
  add column if not exists bio        text,
  add column if not exists location   text,
  add column if not exists website    text,
  add column if not exists gender     text;

alter table payload._members_v
  add column if not exists version_first_name text,
  add column if not exists version_last_name  text,
  add column if not exists version_bio        text,
  add column if not exists version_location   text,
  add column if not exists version_website    text,
  add column if not exists version_gender     text;

-- Backfill from the live app rows so the editor shows current values.
update payload.members m
set first_name = u.first_name,
    last_name  = u.last_name,
    bio        = u.bio,
    location   = u.location,
    website    = u.website,
    gender     = u.gender
from public.users u
where m.app_user_id = u.id::text;;
