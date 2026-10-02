BEGIN;

CREATE TABLE IF NOT EXISTS public.event_lynk_lifecycle (
  event_id integer PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  room_uuid uuid NOT NULL,
  state text NOT NULL DEFAULT 'scheduled'
    CHECK (state IN ('scheduled','ready','live','ended','cancelled')),
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  live_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_lynk_lifecycle_room_uidx
  ON public.event_lynk_lifecycle(room_uuid);
ALTER TABLE public.event_lynk_lifecycle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_lynk_lifecycle FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_lynk_lifecycle TO service_role;

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
  INSERT INTO public.event_lynk_lifecycle(event_id,room_uuid,state,scheduled_start,scheduled_end,updated_at)
  VALUES(e.id,e.lynk_room_id,
    CASE WHEN e.status IN ('cancelled','deleted') THEN 'cancelled'
         WHEN now() >= v_end THEN 'ended'
         WHEN now() >= e.start_date THEN 'live'
         ELSE 'scheduled' END,
    e.start_date,v_end,now())
  ON CONFLICT(event_id) DO UPDATE SET
    room_uuid=excluded.room_uuid,
    scheduled_start=excluded.scheduled_start,
    scheduled_end=excluded.scheduled_end,
    state=CASE
      WHEN e.status IN ('cancelled','deleted') THEN 'cancelled'
      WHEN now() >= excluded.scheduled_end THEN 'ended'
      WHEN now() >= excluded.scheduled_start THEN 'live'
      ELSE 'scheduled' END,
    updated_at=now();
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_event_lynk_lifecycle(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_lynk_lifecycle(integer) TO service_role;

COMMIT;
