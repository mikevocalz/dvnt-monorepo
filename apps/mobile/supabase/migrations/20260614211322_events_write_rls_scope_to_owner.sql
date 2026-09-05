-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260614211322 :: events_write_rls_scope_to_owner). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Scope event writes to the actual owner. Both policies were qual=true → ANY
-- authenticated user could edit/delete ANY event. Mirrors the host-id pattern
-- used across the schema (request.jwt.claims->>'sub' = host_id) + the
-- event_co_organizers table. UPDATE: host or co-organizer. DELETE: host only.

drop policy if exists "events_update_own" on public.events;
drop policy if exists "events_delete_own" on public.events;

create policy "events_update_host_or_coorg" on public.events
  for update to authenticated
  using (
    host_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    or exists (
      select 1 from public.event_co_organizers c
      where c.event_id = events.id
        and c.user_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    )
  )
  with check (
    host_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    or exists (
      select 1 from public.event_co_organizers c
      where c.event_id = events.id
        and c.user_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    )
  );

create policy "events_delete_host" on public.events
  for delete to authenticated
  using (
    host_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
  );;
