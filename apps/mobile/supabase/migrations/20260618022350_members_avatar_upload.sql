-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260618022350 :: members_avatar_upload). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Drag-drop avatar replace: a Payload upload relationship (-> media) on Members.
-- On save, a hook copies the uploaded image URL into public.media and repoints
-- public.users.avatar_id. Additive columns (members + versions).
alter table payload.members add column if not exists avatar_upload_id integer;
alter table payload._members_v add column if not exists version_avatar_upload_id integer;;
