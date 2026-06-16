-- Invite-only access for private Sneaky Lynk rooms.

CREATE TABLE IF NOT EXISTS public.video_room_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id INTEGER NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_video_room_invites_room
  ON public.video_room_invites(room_id);

CREATE INDEX IF NOT EXISTS idx_video_room_invites_user
  ON public.video_room_invites(user_id);

ALTER TABLE public.video_room_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "video_room_invites_select_involved"
  ON public.video_room_invites;
CREATE POLICY "video_room_invites_select_involved"
  ON public.video_room_invites
  FOR SELECT
  USING (
    user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR invited_by = current_setting('request.jwt.claims', true)::json->>'sub'
  );

GRANT SELECT ON public.video_room_invites TO authenticated;
GRANT ALL ON public.video_room_invites TO service_role;
