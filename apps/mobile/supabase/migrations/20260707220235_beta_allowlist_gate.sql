-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260707220235 :: beta_allowlist_gate). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Beta allowlist: emails stored normalized (lower(trim(email))).
create table if not exists public.allowlisted_emails (
  email      text primary key,
  created_at timestamptz not null default now()
);

-- Normalizing gate: case-insensitive, whitespace-trimmed on BOTH sides.
create or replace function public.is_allowlisted(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowlisted_emails
    where email = lower(btrim(p_email))
  );
$$;

revoke all on function public.is_allowlisted(text) from public, anon, authenticated;

-- before-user-created Auth Hook (Postgres-function form). Supabase Auth runs
-- this as supabase_auth_admin, BEFORE the auth.users insert. Return {} to allow,
-- or {error:{http_code,message}} to reject (no auth row is minted on reject).
-- Payload shape verified against docs.supabase.com before-user-created-hook.
create or replace function public.hook_restrict_signup_beta(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(event -> 'user' ->> 'email'));
begin
  if v_email is not null and v_email <> '' and public.is_allowlisted(v_email) then
    return '{}'::jsonb;  -- allow
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Beta Users Access Only'
    )
  );
end;
$$;

-- Auth hooks execute as supabase_auth_admin.
grant execute on function public.hook_restrict_signup_beta(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_beta(jsonb) from public, anon, authenticated;
-- is_allowlisted is called by the hook (definer) and by the pre-signup edge fn
-- (service role); expose to the roles that legitimately need it.
grant execute on function public.is_allowlisted(text) to supabase_auth_admin, service_role;;
