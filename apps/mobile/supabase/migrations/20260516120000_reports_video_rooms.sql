-- Reports for Lynk private video rooms.
-- Client inserts only; safety/admin tooling reads through service role.

CREATE TABLE IF NOT EXISTS public.reports_video_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  reporter_id text NOT NULL,
  reason text,
  details text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_video_rooms_room
  ON public.reports_video_rooms(room_id);

CREATE INDEX IF NOT EXISTS idx_reports_video_rooms_reporter
  ON public.reports_video_rooms(reporter_id);

GRANT INSERT ON public.reports_video_rooms TO authenticated;
GRANT ALL ON public.reports_video_rooms TO service_role;

ALTER TABLE public.reports_video_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_video_rooms_insert"
  ON public.reports_video_rooms;

CREATE POLICY "reports_video_rooms_insert"
  ON public.reports_video_rooms FOR INSERT
  WITH CHECK (
    reporter_id = current_setting('request.jwt.claims', true)::json->>'sub'
  );
