-- revenuecat-webhook secret via Vault (fallback when the platform env secret
-- is unset — the Management API secrets endpoint is closed to this account's
-- token). The secret VALUE is inserted ad hoc via vault.create_secret, never
-- in a migration. This function only exposes the read, service_role-only.

create or replace function public.get_rc_webhook_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'REVENUECAT_WEBHOOK_SECRET'
  limit 1;
$$;

revoke all on function public.get_rc_webhook_secret() from public;
revoke all on function public.get_rc_webhook_secret() from anon;
revoke all on function public.get_rc_webhook_secret() from authenticated;
grant execute on function public.get_rc_webhook_secret() to service_role;
