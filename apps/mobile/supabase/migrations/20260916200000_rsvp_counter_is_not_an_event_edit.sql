-- Every non-host RSVP on the platform failed with a 403.
--
-- Inserting into event_rsvps fires trg_maintain_event_total_attendees_rsvps,
-- which calls recompute_event_total_attendees() and UPDATEs events. That UPDATE
-- fires trg_enforce_event_owner_write. The recompute runs SECURITY DEFINER, but
-- request.jwt.claims is a GUC and survives into it, so the trigger saw the
-- member's own sub against someone else's host_id and raised 42501 —
-- "not authorized to modify this event". PostgREST returned 403, the RSVP
-- mutation swallowed it, and the button looked dead. Ticket issuance on the
-- same rail failed the same way.
--
-- Maintaining a counter is not editing an event. An UPDATE that changes nothing
-- but the maintained attendee counters is allowed; any other column change is
-- still the host's alone, so the guard this trigger exists for is intact.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_event_owner_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_claims text; v_sub text;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '');
  if v_claims is not null then
    v_sub := (v_claims::json ->> 'sub');
  end if;
  -- No end-user JWT → trusted server/definer context (edge fns, webhook).
  if v_sub is null then
    return coalesce(NEW, OLD);
  end if;
  -- Counter maintenance, not an edit: identical row apart from the attendee
  -- counters the definer triggers recompute.
  if TG_OP = 'UPDATE'
     and (to_jsonb(OLD) - 'total_attendees' - 'attendees')
       = (to_jsonb(NEW) - 'total_attendees' - 'attendees') then
    return NEW;
  end if;
  if OLD.host_id = v_sub
     or exists (
       select 1 from public.event_co_organizers c
       where c.event_id = OLD.id and c.user_id = v_sub
     ) then
    return coalesce(NEW, OLD);
  end if;
  raise exception 'not authorized to modify this event' using errcode = '42501';
end
$function$;

COMMIT;
