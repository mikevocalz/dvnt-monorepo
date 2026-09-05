-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260614211611 :: enforce_event_owner_write_trigger). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Defense that survives SECURITY DEFINER RPCs (save_event_aggregate bypasses
-- RLS). SECURITY DEFINER changes the role, NOT the request GUCs, so the caller's
-- JWT sub is still readable here. End-user writes must be by host or co-org;
-- trusted server contexts (service_role / edge fns, no JWT sub) pass through.
create or replace function public.enforce_event_owner_write()
returns trigger language plpgsql security definer set search_path = public as $$
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
  if OLD.host_id = v_sub
     or exists (
       select 1 from public.event_co_organizers c
       where c.event_id = OLD.id and c.user_id = v_sub
     ) then
    return coalesce(NEW, OLD);
  end if;
  raise exception 'not authorized to modify this event' using errcode = '42501';
end $$;

drop trigger if exists trg_enforce_event_owner_write on public.events;
create trigger trg_enforce_event_owner_write
  before update or delete on public.events
  for each row execute function public.enforce_event_owner_write();;
