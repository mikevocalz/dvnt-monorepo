-- REVIEW ARTIFACT ONLY. Not a Supabase migration. Never apply to shared or production databases.
-- Intentionally no grants, scheduler, or app-facing access.
create schema dvnt_host_setup_email;
revoke all on schema dvnt_host_setup_email from public;
create table dvnt_host_setup_email.deliveries (
  host_id bigint primary key check (host_id > 0),
  claim_token uuid not null default gen_random_uuid() unique,
  state text not null default 'reserved' check (state in ('reserved','stale','accepted','uncertain')),
  provider_id text unique,
  reserved_at timestamptz not null default clock_timestamp(),
  recorded_at timestamptz,
  constraint provider_acceptance check (
    (state = 'accepted' and provider_id ~ '^[A-Za-z0-9_-]{1,128}$' and provider_id is not null)
    or (state <> 'accepted' and provider_id is null)
  ),
  constraint final_record check ((state = 'reserved') = (recorded_at is null))
);
revoke all on table dvnt_host_setup_email.deliveries from public;

create function dvnt_host_setup_email.reserve_once(p_host_id bigint)
returns table (delivery_key text, claim_token uuid)
language sql volatile security invoker set search_path = pg_catalog
as $$
  insert into dvnt_host_setup_email.deliveries as d (host_id)
  values (p_host_id)
  on conflict (host_id) do nothing
  returning 'host-payout-setup:v1:' || d.host_id, d.claim_token;
$$;
revoke all on function dvnt_host_setup_email.reserve_once(bigint) from public;

create function dvnt_host_setup_email.record_once(p_host_id bigint, p_claim_token uuid, p_state text, p_provider_id text default null)
returns boolean
language sql volatile security invoker set search_path = pg_catalog
as $$
  with changed as (
    update dvnt_host_setup_email.deliveries as d
    set state = p_state, provider_id = p_provider_id, recorded_at = clock_timestamp()
    where d.host_id = p_host_id and d.claim_token = p_claim_token and d.state = 'reserved'
      and ((p_state = 'accepted' and p_provider_id ~ '^[A-Za-z0-9_-]{1,128}$')
           or (p_state in ('uncertain','stale') and p_provider_id is null))
    returning 1
  )
  select exists (select 1 from changed);
$$;
revoke all on function dvnt_host_setup_email.record_once(bigint,uuid,text,text) from public;
