-- App Store / organizer feedback:
-- - Ticket types need explicit Admission / Product / Service categories.
-- - Event edits should never leave public listing eligibility with a null or
--   legacy visibility value.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ticket_types'
  ) then
    alter table public.ticket_types
      add column if not exists category text default 'admission';

    update public.ticket_types
    set category = 'admission'
    where category is null
      or category not in ('admission', 'product', 'service');

    alter table public.ticket_types
      alter column category set not null;

    alter table public.ticket_types
      drop constraint if exists ticket_types_category_check;

    alter table public.ticket_types
      add constraint ticket_types_category_check
      check (category in ('admission', 'product', 'service'));

    create index if not exists idx_ticket_types_event_category
      on public.ticket_types(event_id, category);
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and column_name = 'visibility'
  ) then
    update public.events
    set visibility = case
      when visibility in ('public', 'private', 'link_only') then visibility
      when visibility = 'unlisted' then 'link_only'
      else 'public'
    end
    where visibility is null
      or visibility not in ('public', 'private', 'link_only');

    alter table public.events
      alter column visibility set default 'public';
  end if;
end $$;
