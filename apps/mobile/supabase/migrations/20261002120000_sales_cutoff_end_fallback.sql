-- Sales cutoff: a NULL end_date means "assumed six-hour event", not
-- "sales close at doors".
--
-- BUG: events.end_date is nullable and NULL on most rows. The RSVP
-- trigger anchored on COALESCE(end_date, start_date, date) − 30 min, so
-- an 8pm event with no end_date refused RSVPs from 7:30pm — while the
-- event was still running. Same fix as _shared/sales-cutoff.ts and
-- COALESCE(end_date, start_date + interval '6 hours') in get_events_home.
--
-- Nothing else changes — same SECURITY DEFINER trigger, same
-- 'not_going' carve-out, same 30-minute lead. Cancelling an RSVP on an
-- ended event stays allowed.
--
-- DOWN: re-run 20260924000000_event_rsvps_sales_cutoff.sql verbatim.

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

  select coalesce(e.end_date, e.start_date + interval '6 hours', e.date)
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

NOTIFY pgrst, 'reload schema';
