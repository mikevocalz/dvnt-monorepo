-- Block RSVP writes once an event's sales window has closed.
--
-- rsvpEvent() writes event_rsvps directly through PostgREST — no edge
-- function guards it — so the "no tickets/RSVPs after end" rule needs a
-- database enforcement point, same anchor chain as
-- _shared/sales-cutoff.ts: COALESCE(end_date, start_date, date) − 30 min.
-- Cancelling (not_going) stays allowed on ended events.

create or replace function public.event_rsvps_enforce_sales_cutoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anchor timestamptz;
begin
  if new.status = 'not_going' then
    return new;
  end if;

  select coalesce(e.end_date, e.start_date, e.date)
    into v_anchor
    from public.events e
   where e.id = new.event_id;

  -- No resolvable anchor → nothing to enforce (mirrors isSalesClosed).
  if v_anchor is null then
    return new;
  end if;

  if now() >= v_anchor - interval '30 minutes' then
    raise exception 'event_sales_closed'
      using errcode = 'P0001',
            hint = 'RSVPs close 30 minutes before the event ends.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_event_rsvps_sales_cutoff on public.event_rsvps;
create trigger trg_event_rsvps_sales_cutoff
  before insert or update on public.event_rsvps
  for each row
  execute function public.event_rsvps_enforce_sales_cutoff();
