-- ============================================================
-- Video Host Controls: RPCs, role changes, mute events
-- Adds co-host role, moderation RPCs, video_room_kicks table
-- ============================================================

-- Add co-host to allowed roles
ALTER TABLE public.video_room_members
  DROP CONSTRAINT IF EXISTS video_room_members_role_check;
ALTER TABLE public.video_room_members
  ADD CONSTRAINT video_room_members_role_check
  CHECK (role IN ('host', 'co-host', 'moderator', 'speaker', 'participant'));

-- video_room_kicks (referenced by video_kick_user edge function)
CREATE TABLE IF NOT EXISTS public.video_room_kicks (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  kicked_by TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_room_kicks_room_idx ON public.video_room_kicks (room_id);

-- can_user_moderate_room: host or co-host can moderate
CREATE OR REPLACE FUNCTION public.can_user_moderate_room(
  p_user_id TEXT,
  p_room_id INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role
  FROM public.video_room_members
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND status = 'active';

  RETURN user_role IN ('host', 'co-host', 'moderator');
END;
$$;

-- get_user_room_role: returns the user's role in a room
CREATE OR REPLACE FUNCTION public.get_user_room_role(
  p_user_id TEXT,
  p_room_id INTEGER
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role
  FROM public.video_room_members
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND status = 'active';

  RETURN user_role;
END;
$$;

-- Enable RLS on kicks
ALTER TABLE public.video_room_kicks ENABLE ROW LEVEL SECURITY;
