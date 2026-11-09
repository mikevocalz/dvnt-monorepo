-- Read-only release preflight. Every result must be true before release.
-- Run against the specifically approved target, not an inferred project.
-- Migration identity requires the reviewed bytes, not just a name/version.
-- The migration tool may record the approved SQL under its generated version.
select
  to_regprocedure('public.set_message_reaction(bigint,text,text,boolean)') is not null as rpc_installed,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version in ('20260905123000', '20261030131710')
      and name = 'atomic_message_reactions'
      and cardinality(statements) = 1
      and encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') =
        '29f17beae2f230a3f2986a88a990589e03d856c90d3ed318d7bee91d3ab25aa2'
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
