-- One publish attempt must create at most one event, including network retries.
alter table public.events add column if not exists client_request_id text;
create unique index if not exists events_host_client_request_id_key
  on public.events (host_id, client_request_id)
  where client_request_id is not null;

-- Validate both creation and editing; a host must never attach another
-- person's room (or a personal call) and take over its event access policy.
create or replace function public.validate_event_lynk_room()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_room public.video_rooms%rowtype;
begin
  if NEW.lynk_room_id is null then return NEW; end if;
  if TG_OP = 'UPDATE' and NEW.lynk_room_id is not distinct from OLD.lynk_room_id
    and NEW.host_id is not distinct from OLD.host_id then return NEW; end if;
  select * into v_room from public.video_rooms where uuid = NEW.lynk_room_id for update;
  if not found or v_room.room_kind is distinct from 'lynk' or v_room.created_by is distinct from NEW.host_id then
    raise exception 'The event host must own this Sneaky Lynk room' using errcode = '42501';
  end if;
  if exists (select 1 from public.events where lynk_room_id = NEW.lynk_room_id and id <> NEW.id) then
    raise exception 'This room is already attached to another event' using errcode = '23505';
  end if;
  return NEW;
end;
$$;
drop trigger if exists validate_event_lynk_room on public.events;
create trigger validate_event_lynk_room before insert or update of lynk_room_id, host_id
  on public.events for each row execute function public.validate_event_lynk_room();

-- Host-authorized deletion in ONE transaction. Never partially delete the
-- attendee list and then report success for a zero-row/RLS-blocked DELETE.
-- Commerce history stays intact: paid events use cancellation/refunds instead.
create or replace function public.delete_event_guarded(p_event_id integer, p_actor_auth_id text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_deleted integer;
  v_room_id integer;
  v_room_owner text;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Event not found');
  end if;
  if p_actor_auth_id is null or (
    v_event.host_id = p_actor_auth_id or exists (
      select 1 from public.users u
      where u.auth_id = p_actor_auth_id and u.id::text = v_event.host_id
    )
  ) is not true then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Only the event host can delete this event');
  end if;

  -- Block even refunded paid records: tickets/cart lines/financial snapshots
  -- have cascade FKs and must remain available for disputes and accounting.
  if exists (select 1 from public.tickets where event_id = p_event_id
    and (stripe_payment_intent_id is not null or coalesce(purchase_amount_cents, 0) > 0))
    or exists (select 1 from public.orders where event_id = p_event_id)
    or exists (select 1 from public.carts where event_id = p_event_id)
    or exists (select 1 from public.event_spotlight_campaigns where event_id = p_event_id
      and (stripe_payment_intent_id is not null or coalesce(amount_cents, 0) > 0))
    or exists (select 1 from public.event_financials where event_id = p_event_id
      and (coalesce(gross_cents, 0) <> 0 or coalesce(refunds_cents, 0) <> 0))
  then
    return jsonb_build_object('ok', false, 'code', 'commerce_history',
      'message', 'This event has ticket payments or a checkout in progress. Cancel the event instead; payment and ticket records must be retained.');
  end if;

  -- Deleted event links must not turn back into ordinary joinable rooms.
  if v_event.lynk_room_id is not null then
    select id, created_by into v_room_id, v_room_owner from public.video_rooms
      where uuid = v_event.lynk_room_id for update;
    if found and v_room_owner is distinct from v_event.host_id then
      return jsonb_build_object('ok', false, 'code', 'room_owner_mismatch',
        'message', 'This event references a room owned by another host. Resolve the room link before deleting.');
    end if;
    if exists (select 1 from public.events where lynk_room_id = v_event.lynk_room_id and id <> p_event_id) then
      return jsonb_build_object('ok', false, 'code', 'shared_room',
        'message', 'This room is shared by another event. Resolve the room links before deleting.');
    end if;
    update public.video_rooms set status = 'ended', ended_at = now(), participant_count = 0
      where uuid = v_event.lynk_room_id and created_by = v_event.host_id
      returning id into v_room_id;
    if v_room_id is not null then
      update public.video_room_members set status = 'left', left_at = now(), hand_raised = false
        where room_id = v_room_id and status = 'active';
      update public.video_room_tokens set revoked = true
        where room_id = v_room_id and revoked = false;
      insert into public.video_room_events(room_id, type, actor_id, payload)
        values (v_room_id, 'room_ended', p_actor_auth_id, jsonb_build_object('reason', 'event_deleted'));
    end if;
  end if;
  delete from public.events where id = p_event_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then raise exception 'Event deletion was not confirmed'; end if;
  return jsonb_build_object('ok', true, 'eventId', p_event_id);
end;
$$;
revoke all on function public.delete_event_guarded(integer, text) from public, anon, authenticated;
grant execute on function public.delete_event_guarded(integer, text) to service_role;
-- Retired clients must not bypass commerce checks/room teardown with a direct
-- PostgREST DELETE. Trusted service operations retain their own privileges.
revoke delete on table public.events from public, anon, authenticated;
