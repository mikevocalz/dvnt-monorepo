-- End expired video rooms server-side, for everyone.
--
-- A free-tier Lynk gets ends_at = created+5min at video_create_room. Until now
-- the deadline existed only as a join gate: new members were refused while the
-- host stayed connected inside a room the server still called 'open' — the
-- "Lynk closed" report for anyone invited to a live room, plus zombie rooms
-- that stayed open forever when the host's tab died without cleanup.
--
-- The sweep is the authoritative end: marks members left, emits one
-- room_ended event per room (which is what the Lynk room's realtime
-- subscription ejects every client on), and flips the row to 'ended'.
--
-- Calls are exempt from the 5-minute wall (a personal call has no session
-- tier; video_join_room skips ends_at for room_kind='call'), but a call room
-- six hours past its ends_at is dead weight — the members were never marked
-- left because no leave path existed — so it sweeps those too.
--
-- Runs every minute via pg_cron. Rollback: cron.unschedule('end-expired-video-rooms'),
-- drop function public.end_expired_video_rooms().

create or replace function public.end_expired_video_rooms()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids integer[];
begin
  select array(
    select r.id
    from public.video_rooms r
    where r.status = 'open'
      and r.ends_at is not null
      and (
        -- Lynk rooms die on their deadline.
        (r.room_kind <> 'call' and r.ends_at <= now())
        or
        -- Call rooms get a long grace: a real call outlives the copied
        -- 5-minute stamp, a dead one does not need to be joinable tomorrow.
        (r.room_kind = 'call' and r.ends_at <= now() - interval '6 hours')
      )
    for update of r skip locked
  ) into v_ids;

  if v_ids is null then
    return 0;
  end if;

  update public.video_room_members
  set status = 'left', left_at = now(), hand_raised = false
  where room_id = any (v_ids) and status = 'active';

  -- One room_ended event per room — the Lynk client's realtime subscription
  -- ejects every connected member on this insert, so participants see the
  -- ended surface instead of a live-looking dead room.
  insert into public.video_room_events (room_id, type, actor_id, payload)
  select r.id, 'room_ended', r.created_by,
         jsonb_build_object('reason', 'session_expired')
  from public.video_rooms r
  where r.id = any (v_ids);

  update public.video_rooms
  set status = 'ended', ended_at = now(), participant_count = 0
  where id = any (v_ids) and status = 'open';

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

revoke all on function public.end_expired_video_rooms() from public;
revoke all on function public.end_expired_video_rooms() from anon;
revoke all on function public.end_expired_video_rooms() from authenticated;
grant execute on function public.end_expired_video_rooms() to service_role;

do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $$select cron.unschedule('end-expired-video-rooms')$$;
    exception
      when others then null;
    end;

    execute $$select cron.schedule(
      'end-expired-video-rooms',
      '* * * * *',
      'select public.end_expired_video_rooms();'
    )$$;
  end if;
end $cron$;
