-- Private STAGING-ONLY review artifact. Not an application migration. Do not apply here.
-- The schema owner must hold only the source read access necessary for this adapter.
-- A stage operator supplies the exact one test host/event/inbox and reviewed suppression
-- adapter out-of-band. No roles, grants, credentials, or scheduler are installed here.
create table dvnt_host_setup_email.staging_target (
  singleton boolean primary key default true check (singleton),
  host_id bigint not null check (host_id > 0),
  event_id bigint not null check (event_id > 0),
  inbox text not null
);
revoke all on table dvnt_host_setup_email.staging_target from public;

create function dvnt_host_setup_email.staging_source(p_host bigint, p_event bigint)
returns table(host_id bigint,event_id bigint,app_auth_id text,auth_id text,email text,email_verified boolean,stripe_account_id text)
language sql stable security definer set search_path = pg_catalog
as $$
  select p.id::bigint,e.id::bigint,p.auth_id,a.id,a.email,a."emailVerified",oa.stripe_account_id
  from dvnt_host_setup_email.staging_target s
  join public.users p on p.id = s.host_id
  join public."user" a on a.id=p.auth_id
  join public.events e on e.id=s.event_id and e.host_id=a.id
  left join public.organizer_accounts oa on oa.host_id=a.id
  where s.host_id=p_host and s.event_id=p_event and a.email=s.inbox and a."emailVerified" is true
    and not exists(select 1 from public.users other where other.auth_id=p.auth_id and other.id<>p.id)
  limit 2;
$$;
revoke all on function dvnt_host_setup_email.staging_source(bigint,bigint) from public;

create function dvnt_host_setup_email.staging_reserve(p_host bigint)
returns table(delivery_key text,claim_token uuid)
language sql volatile security definer set search_path = pg_catalog
as $$
  select r.delivery_key,r.claim_token from dvnt_host_setup_email.staging_target t
  cross join lateral dvnt_host_setup_email.reserve_once(t.host_id) r where t.host_id=p_host;
$$;
revoke all on function dvnt_host_setup_email.staging_reserve(bigint) from public;

create function dvnt_host_setup_email.staging_record(p_host bigint,p_token uuid,p_state text,p_provider text)
returns boolean
language sql volatile security definer set search_path = pg_catalog
as $$
  select coalesce((select dvnt_host_setup_email.record_once(t.host_id,p_token,p_state,p_provider)
    from dvnt_host_setup_email.staging_target t where t.host_id=p_host),false);
$$;
revoke all on function dvnt_host_setup_email.staging_record(bigint,uuid,text,text) from public;
