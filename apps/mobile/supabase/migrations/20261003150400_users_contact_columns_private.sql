-- Stop clients reading email, password hashes and other private columns of
-- public.users and Better Auth's public."user".
--
-- Before this migration, on production (read 2026-10-03):
--   public.users   relacl anon=arw, authenticated=arwd (table-wide SELECT)
--                  "Users are viewable by everyone" FOR SELECT TO public USING (true)
--   public."user"  relacl anon=r, authenticated=r
--                  user_select_anon FOR SELECT TO anon USING (true)
--   No column-level grants on either table.
--
-- So the anon key in any app bundle read every member's email from both
-- tables (1286 of 1286 users rows have one), plus users.hash and users.salt
-- (5 rows: legacy Payload passwords, which promote-admin reuses as admin
-- passwords), reset_password_token, api_key and the precise device_lat /
-- device_lng location columns.
--
-- After this migration anon and authenticated keep SELECT on every column
-- except the ones listed below. Row visibility (the policies) is unchanged.
-- Filtering or ordering on a revoked column is a 42501 too, so an email
-- cannot be probed with ?email=eq.
--
-- Nothing in the database reads these columns as a client role: no view,
-- policy or SECURITY INVOKER function references them (checked against
-- pg_policy, pg_rewrite and pg_proc). Better Auth reads "user" through its
-- own Postgres pool in the auth edge function, and every other server path
-- uses service_role or a direct connection, none of which is affected. The
-- app's own email comes from the Better Auth session (identity.ts
-- ownEmailFor), not from these tables.
--
-- A column added to either table later is NOT readable by clients until it
-- is granted. That is the intended default for these two tables.

begin;

do $$
declare
  t record;
  col record;
begin
  for t in
    select * from (values
      ('public.users'::regclass, array[
        'email', 'hash', 'salt', 'reset_password_token', 'reset_password_expiration',
        'api_key', 'api_key_index', 'enable_a_p_i_key', 'login_attempts', 'lock_until',
        'device_lat', 'device_lng', 'location_updated_at'
      ]::text[]),
      ('public."user"'::regclass, array[
        'email', 'emailVerified', 'role', 'banned', 'banReason', 'banExpires'
      ]::text[])
    ) as v(rel, private_cols)
  loop
    execute format('revoke select on table %s from anon, authenticated', t.rel);
    for col in
      select attname
      from pg_attribute
      where attrelid = t.rel and attnum > 0 and not attisdropped
    loop
      execute format(
        'revoke select (%I) on %s from anon, authenticated', col.attname, t.rel
      );
      if not (col.attname = any (t.private_cols)) then
        execute format(
          'grant select (%I) on %s to anon, authenticated', col.attname, t.rel
        );
      end if;
    end loop;
  end loop;
end
$$;

commit;
