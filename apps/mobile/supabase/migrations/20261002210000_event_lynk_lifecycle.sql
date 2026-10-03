BEGIN;

-- One row per event that owns a Sneaky Lynk room.
--
-- The room opens only when a host starts it (event-lynk-room, action
-- "start"), the way a Zoom meeting starts when the host clicks Start. The
-- clock never opens a room: sync_event_lynk_lifecycle below moves a row to
-- 'ended' or 'cancelled' and otherwise leaves a host's 'live' alone.
CREATE TABLE IF NOT EXISTS public.event_lynk_lifecycle (
  event_id integer PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  room_uuid uuid NOT NULL,
  state text NOT NULL DEFAULT 'scheduled'
    CHECK (state IN ('scheduled','ready','live','ended','cancelled')),
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  live_at timestamptz,
  started_by text,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_lynk_lifecycle_room_uidx
  ON public.event_lynk_lifecycle(room_uuid);
ALTER TABLE public.event_lynk_lifecycle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_lynk_lifecycle FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_lynk_lifecycle TO service_role;

-- Waiting room presence: an eligible attendee who opened the room before the
-- host started it. Written only by the event-lynk-room edge function with the
-- service role; no client role can read or write it directly. Rows are
-- presence, not admission: once the room is live each client goes through
-- video_join_room, which applies the ban, capacity and verification gates.
CREATE TABLE IF NOT EXISTS public.event_lynk_waiting (
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  admitted_at timestamptz,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS event_lynk_waiting_event_seen_idx
  ON public.event_lynk_waiting(event_id, last_seen_at DESC);
ALTER TABLE public.event_lynk_waiting ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_lynk_waiting FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_lynk_waiting TO service_role;

CREATE OR REPLACE FUNCTION public.sync_event_lynk_lifecycle(p_event_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE e public.events%ROWTYPE; v_end timestamptz;
BEGIN
  SELECT * INTO e FROM public.events WHERE id=p_event_id FOR SHARE;
  IF NOT FOUND OR e.lynk_room_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Event or Lynk room missing');
  END IF;
  v_end := COALESCE(e.end_date, e.start_date + interval '6 hours');
  -- A new row is never live: only a host's start makes it live.
  INSERT INTO public.event_lynk_lifecycle(event_id,room_uuid,state,scheduled_start,scheduled_end,updated_at)
  VALUES(e.id,e.lynk_room_id,
    CASE WHEN e.status IN ('cancelled','deleted') THEN 'cancelled'
         WHEN now() >= v_end THEN 'ended'
         ELSE 'scheduled' END,
    e.start_date,v_end,now())
  ON CONFLICT(event_id) DO UPDATE SET
    room_uuid=excluded.room_uuid,
    scheduled_start=excluded.scheduled_start,
    scheduled_end=excluded.scheduled_end,
    -- Time only ends a room. A row a host started stays 'live' until the
    -- event ends or is cancelled; anything else stays as it was.
    state=CASE
      WHEN e.status IN ('cancelled','deleted') THEN 'cancelled'
      WHEN now() >= excluded.scheduled_end THEN 'ended'
      WHEN event_lynk_lifecycle.state IN ('ended','cancelled') THEN 'scheduled'
      ELSE event_lynk_lifecycle.state END,
    ended_at=CASE
      WHEN e.status IN ('cancelled','deleted') OR now() >= excluded.scheduled_end
        THEN COALESCE(event_lynk_lifecycle.ended_at, now())
      ELSE NULL END,
    updated_at=now();
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_event_lynk_lifecycle(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_lynk_lifecycle(integer) TO service_role;

-- Backfill: events already in progress when this ships.
--
-- Until now an event room opened on the clock, so guests of an event that is
-- running right now are already in or on their way in. Without a row they
-- would land in a waiting room for a Start nobody knows to press. Mark those
-- events live (started_by stays NULL: no host pressed anything). Events that
-- have not started, have ended, or are cancelled get no row here and stay
-- 'scheduled' until sync_event_lynk_lifecycle or a host creates one. A room
-- shared by more than one event is skipped: event-lynk-room refuses those,
-- and two rows would break event_lynk_lifecycle_room_uidx.
INSERT INTO public.event_lynk_lifecycle
  (event_id, room_uuid, state, scheduled_start, scheduled_end, live_at, started_by, updated_at)
SELECT e.id, e.lynk_room_id, 'live', e.start_date,
       COALESCE(e.end_date, e.start_date + interval '6 hours'), now(), NULL, now()
FROM public.events e
WHERE e.lynk_room_id IS NOT NULL
  AND COALESCE(e.status, '') NOT IN ('cancelled','deleted')
  AND e.start_date <= now()
  AND now() < COALESCE(e.end_date, e.start_date + interval '6 hours')
  AND NOT EXISTS (
    SELECT 1 FROM public.events other
    WHERE other.lynk_room_id = e.lynk_room_id AND other.id <> e.id
  )
ON CONFLICT (event_id) DO UPDATE SET
  state = 'live',
  live_at = COALESCE(public.event_lynk_lifecycle.live_at, now()),
  updated_at = now()
WHERE public.event_lynk_lifecycle.state IN ('scheduled','ready');

COMMIT;
