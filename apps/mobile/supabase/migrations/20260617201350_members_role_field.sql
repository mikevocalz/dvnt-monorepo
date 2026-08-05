-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260617201350 :: members_role_field). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- User-consented (build-both): add a `role` select field to Payload Members,
-- mirroring the existing status-enum convention exactly (main enum + versioned
-- enum + both columns) so the deployed Payload (PAYLOAD_PUSH=false) finds the
-- schema it expects. Additive + staged — does not touch existing columns.
do $$ begin
  create type payload.enum_members_role as enum ('Super-Admin','Admin','Moderator','Basic');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payload.enum__members_v_version_role as enum ('Super-Admin','Admin','Moderator','Basic');
exception when duplicate_object then null; end $$;

alter table payload.members add column if not exists role payload.enum_members_role;
alter table payload._members_v add column if not exists version_role payload.enum__members_v_version_role;

-- Backfill current app roles so the dropdown shows each member's real role.
update payload.members m
set role = (u.role)::text::payload.enum_members_role
from public.users u
where m.app_user_id = u.id::text and m.role is null and u.role is not null;;
