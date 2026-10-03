-- An event may not end before it starts.
--
-- Edits go straight to PostgREST (eventsApi.updateEvent), so without this
-- nothing on the server stops an end_date earlier than start_date: the native
-- create screen, both edit screens and the create-event function all accepted
-- one. create-event now refuses it too; this covers every other write path.
--
-- end_date stays optional (NULL means "assume start + 6h" everywhere). Equal
-- start and end is allowed here; the forms ask for an end after the start.
--
-- NOT VALID then VALIDATE: the ADD takes a brief ACCESS EXCLUSIVE lock without
-- scanning, and VALIDATE scans under SHARE UPDATE EXCLUSIVE, so reads and
-- writes keep flowing. Read-only check on the live project before writing
-- this (2026-10-03): 0 rows with end_date < start_date.

alter table public.events
  drop constraint if exists events_end_not_before_start;

alter table public.events
  add constraint events_end_not_before_start
  check (end_date is null or end_date >= start_date) not valid;

alter table public.events
  validate constraint events_end_not_before_start;
