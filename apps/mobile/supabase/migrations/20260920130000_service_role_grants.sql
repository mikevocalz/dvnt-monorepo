-- Corrective grants: 11 tables were created without service_role DML, so
-- every edge function using the service key gets 42501 on them. Notably
-- web_push_keys (web/PWA push) was silently failing in production.
--
-- Production note (dvnt-social): call_media_leases, call_media_peers and
-- payload do not exist there — remote migration drift left them unapplied.
-- Their grants were skipped when this file was applied by hand; if those
-- tables are ever created in prod, re-run the matching grant line.
grant select, insert, update, delete on public.allowlisted_emails to service_role;
grant select, insert, update, delete on public.call_media_leases to service_role;
grant select, insert, update, delete on public.call_media_peers to service_role;
grant select, insert, update, delete on public.event_presence to service_role;
grant select, insert, update, delete on public.identity_verifications to service_role;
grant select, insert, update, delete on public.onboarding_state to service_role;
grant select, insert, update, delete on public.payload to service_role;
grant select, insert, update, delete on public.rc_events to service_role;
grant select, insert, update, delete on public.verification_events to service_role;
grant select, insert, update, delete on public.verified_admission_policy to service_role;
grant select, insert, update, delete on public.web_push_keys to service_role;

-- internal_fn_secrets predates the migrations dir, so a literal grant would
-- abort on environments where it is absent. Guard it: where the table
-- exists (it does in prod — DB-trigger push auth was 401ing without this),
-- service_role gets full DML.
do $$
begin
  if to_regclass('public.internal_fn_secrets') is not null then
    execute 'grant select, insert, update, delete on public.internal_fn_secrets to service_role';
  end if;
end $$;
