-- Lock public.users against direct client writes.
--
-- Before this migration, on production (read via pg_class.relacl and pg_policy):
--   relacl: anon=arw, authenticated=arwd
--   "Users can update own profile"  FOR UPDATE TO public USING (true)
--   users_insert_anon               FOR INSERT TO anon          WITH CHECK (true)
--   users_insert_authenticated      FOR INSERT TO authenticated WITH CHECK (true)
--
-- Clients reach PostgREST as anon (or as authenticated via the
-- mint-supabase-jwt bridge), and the anon key ships in every app bundle. So
-- anyone could PATCH /rest/v1/users?id=eq.N and set role, verified, email or
-- auth_id on any member. auth_id is what auth-sync and resolve-user map a
-- Better Auth session to, so rewriting it hands one member's account to
-- another session.
--
-- No client code needs these privileges. Every legitimate write already runs
-- in an edge function with the service_role key, which bypasses RLS and keeps
-- its own grants:
--   update-profile, update-avatar, auth-sync, delete-account, backfill-users,
--   create-test-user, _shared/resolve-user.ts
-- The counter triggers on follows/posts are SECURITY DEFINER and are not
-- affected. The two client writes that existed (auth.ts getProfile linking
-- auth_id by email, and the uncalled auth.updateProfile) are removed in the
-- same change.
--
-- No column is re-granted. If a client-side profile write is ever needed, add
-- it to update-profile instead: the UPDATE policy below was USING (true), so a
-- column grant would let anyone edit anyone's row.
--
-- SELECT (table grant and "Users are viewable by everyone") is untouched.

begin;

revoke insert, update, delete, truncate, references, trigger
  on table public.users from anon, authenticated;

-- Column-level grants survive a table-level REVOKE. Production has none today
-- (pg_attribute.attacl is null for every column), but revoke them by name so
-- the result does not depend on that staying true.
do $$
declare
  col text;
begin
  for col in
    select quote_ident(attname)
    from pg_attribute
    where attrelid = 'public.users'::regclass
      and attnum > 0
      and not attisdropped
  loop
    execute format(
      'revoke insert (%1$s), update (%1$s), references (%1$s) on public.users from anon, authenticated',
      col
    );
  end loop;
end
$$;

-- With the grants gone these policies are inert, but each one says "any row,
-- any value". A later blanket GRANT (Supabase's dashboard and some tooling
-- re-grant on all tables) would bring the hole straight back. Drop them so
-- RLS denies writes on its own.
drop policy if exists "Users can update own profile" on public.users;
drop policy if exists users_insert_anon on public.users;
drop policy if exists users_insert_authenticated on public.users;

commit;
