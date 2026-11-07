-- Source only. Apply after 20261107150000 and before deploying callers of
-- start_event_lynk_atomic. No room is reopened or live data repaired here.
BEGIN;

-- Keep the same event -> room lock order as expire_event_lynk_room and event
-- edits. Admission locks only the room and never waits for an event row.
-- A same-room terminal lifecycle is permanent, even when dates are moved.
-- Preparing and linking a DIFFERENT open room is the explicit restart path.
CREATE OR REPLACE FUNCTION public.sync_event_lynk_lifecycle(p_event_id integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  e public.events%ROWTYPE;
  r public.video_rooms%ROWTYPE;
  previous public.event_lynk_lifecycle%ROWTYPE;
  same_room boolean;
  next_state text;
  duration_end timestamptz;
  effective_end timestamptz;
  at_time timestamptz;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR e.lynk_room_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_unavailable', 'error', 'Event or Lynk room missing');
  END IF;
  SELECT * INTO r FROM public.video_rooms WHERE uuid = e.lynk_room_id FOR UPDATE;
  IF NOT FOUND OR r.room_kind IS DISTINCT FROM 'lynk'
     OR r.created_by IS DISTINCT FROM e.host_id OR r.is_public IS DISTINCT FROM false THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended', 'error', 'This event needs a valid private Lynk room');
  END IF;
  -- New links take the room lock in validate_event_lynk_room. Thus an
  -- attachment cannot race this duplicate check and the lifecycle write.
  IF (SELECT count(*) FROM public.events WHERE lynk_room_id = r.uuid) <> 1
     OR EXISTS (SELECT 1 FROM public.event_lynk_lifecycle WHERE room_uuid = r.uuid AND event_id <> e.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_link_ambiguous', 'error', 'The event room link could not be verified');
  END IF;
  IF e.start_date IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_schedule_missing', 'error', 'The event schedule is not ready');
  END IF;
  SELECT * INTO previous FROM public.event_lynk_lifecycle WHERE event_id = e.id FOR UPDATE;
  same_room := previous.event_id IS NOT NULL AND previous.room_uuid = r.uuid;
  at_time := clock_timestamp();

  -- Same effective deadline as event-access.ts and the admission allocator.
  -- Do not rewrite ends_at: it retains the purchased plan's original length.
  duration_end := r.ends_at;
  IF r.ends_at IS NOT NULL AND r.created_at IS NOT NULL THEN
    duration_end := greatest(e.start_date, r.created_at)
      + greatest(interval '0', r.ends_at - r.created_at);
  END IF;
  IF e.end_date IS NOT NULL THEN
    effective_end := least(e.end_date, duration_end);
  ELSE
    effective_end := greatest(e.start_date + interval '6 hours', duration_end);
  END IF;
  next_state := CASE
    WHEN e.status IN ('cancelled', 'deleted') THEN 'cancelled'
    WHEN same_room AND previous.state IN ('ended', 'cancelled') THEN previous.state
    WHEN r.status IS DISTINCT FROM 'open' OR at_time >= effective_end THEN 'ended'
    WHEN same_room THEN previous.state
    ELSE 'scheduled' END;

  INSERT INTO public.event_lynk_lifecycle (
    event_id, room_uuid, state, scheduled_start, scheduled_end,
    live_at, started_by, ended_at, updated_at
  ) VALUES (
    e.id, r.uuid, next_state, e.start_date, effective_end,
    CASE WHEN same_room THEN previous.live_at ELSE NULL END,
    CASE WHEN same_room THEN previous.started_by ELSE NULL END,
    CASE WHEN next_state IN ('ended', 'cancelled')
      THEN coalesce(CASE WHEN same_room THEN previous.ended_at END, at_time) ELSE NULL END,
    at_time
  ) ON CONFLICT (event_id) DO UPDATE SET
    room_uuid = excluded.room_uuid, state = excluded.state,
    scheduled_start = excluded.scheduled_start, scheduled_end = excluded.scheduled_end,
    live_at = excluded.live_at, started_by = excluded.started_by,
    ended_at = excluded.ended_at, updated_at = excluded.updated_at;
  RETURN jsonb_build_object('ok', true, 'state', next_state);
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_event_lynk_lifecycle(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_lynk_lifecycle(integer) TO service_role;

-- The edge verifies the signed-in actor, admission policy and creator
-- standing. Recheck host authority and room/lifecycle eligibility atomically:
-- a concurrent end, cancellation, relink or postponement cannot slip between
-- a preflight read and making the room live.
CREATE OR REPLACE FUNCTION public.start_event_lynk_atomic(p_event_id integer, p_actor text, p_room_uuid uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  e public.events%ROWTYPE;
  lifecycle public.event_lynk_lifecycle%ROWTYPE;
  synced jsonb;
  started boolean;
  admitted integer;
  at_time timestamptz;
BEGIN
  IF nullif(btrim(p_actor), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_host', 'message', 'Only a host can do this');
  END IF;
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR e.lynk_room_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_unavailable', 'message', 'Event or Lynk room missing');
  END IF;
  IF e.lynk_room_id IS DISTINCT FROM p_room_uuid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_link_changed',
      'message', 'The event room changed. Open the event again.');
  END IF;
  IF e.host_id IS DISTINCT FROM p_actor THEN
    -- A pending staff invite or scanner cannot start the room. Hold accepted
    -- authority stable until the start commits, including concurrent removal.
    PERFORM 1 FROM public.event_co_organizers
      WHERE event_id = e.id AND user_id = p_actor AND accepted = true AND role IN ('admin', 'editor')
      FOR SHARE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_host', 'message', 'Only a host can do this');
    END IF;
  END IF;
  synced := public.sync_event_lynk_lifecycle(e.id);
  IF coalesce((synced->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN synced || jsonb_build_object('message', synced->>'error');
  END IF;
  -- sync retains the event and room locks until THIS transaction commits.
  SELECT * INTO lifecycle FROM public.event_lynk_lifecycle WHERE event_id = e.id FOR UPDATE;
  IF lifecycle.state IN ('ended', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false,
      'reason', CASE WHEN lifecycle.state = 'cancelled' THEN 'event_unavailable' ELSE 'room_ended' END,
      'message', CASE WHEN lifecycle.state = 'cancelled' THEN 'This event was cancelled' ELSE 'This Lynk has ended' END,
      'state', lifecycle.state);
  END IF;
  IF lifecycle.state IS NULL OR lifecycle.state NOT IN ('scheduled', 'ready', 'live') THEN
    RAISE EXCEPTION 'Could not verify the Lynk lifecycle';
  END IF;
  at_time := clock_timestamp();
  started := lifecycle.state <> 'live';
  IF started THEN
    UPDATE public.event_lynk_lifecycle SET state = 'live', live_at = at_time,
      started_by = p_actor, updated_at = at_time WHERE event_id = e.id;
  END IF;
  -- Presence bookkeeping never writes video_room_members or grants a seat.
  -- Every guest still joins through the verified ticket/ban/capacity gates.
  UPDATE public.event_lynk_waiting SET admitted_at = at_time
    WHERE event_id = e.id AND admitted_at IS NULL;
  GET DIAGNOSTICS admitted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'started', started, 'admitted', admitted);
END;
$function$;
REVOKE ALL ON FUNCTION public.start_event_lynk_atomic(integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_event_lynk_atomic(integer, text, uuid) TO service_role;

COMMIT;
