-- Read-only release preflight. Every result must be true before release.
-- Run against the specifically approved target, not an inferred project.
select
  to_regprocedure('public.set_message_reaction(bigint,text,text,boolean)') is not null as rpc_installed,
  exists (
    select 1 from supabase_migrations.schema_migrations where version = '20260905123000'
  ) as migration_recorded,
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) as realtime_published,
  coalesce((
    select has_function_privilege('service_role', p.oid, 'EXECUTE')
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    from pg_proc p
    where p.oid = to_regprocedure('public.set_message_reaction(bigint,text,text,boolean)')
  ), false) as rpc_service_only;
